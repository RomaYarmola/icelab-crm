import { integrationLogs } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * Клієнт personal API monobank (B13, ТЗ 8.5, D186, D187): лише читання. Токен у змінній
 * `MONOPAY_API_KEY` на сервері; у базі, журналах і відповідях його немає. Таймаут 15 секунд, до трьох
 * спроб (паузи 1, 4, 16 с) на мережевих помилках і 5xx; 403 і 429 не повторюємо. Кожен виклик
 * пишемо в `integration_logs` без токена й без самих платежів (лише кількість).
 */

export const MONOBANK_API_URL = "https://api.monobank.ua";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000];

export function getMonobankToken(): string | null {
  return process.env.MONOPAY_API_KEY?.trim() || null;
}

export class MonobankError extends Error {
  /** HTTP-статус відповіді; `null`, якщо відповіді не було (мережа, таймаут). */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "MonobankError";
    this.status = status;
  }

  /** Токен відхилено: його треба замінити. */
  get isAuth(): boolean {
    return this.status === 403;
  }

  /** Забагато запитів: спробувати пізніше. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export type MonobankAccount = {
  id: string;
  /** `black`, `fop`, `eAid`… Нас цікавить лише `fop`. */
  type?: string;
  /** ISO 4217: 980 це гривня. */
  currencyCode?: number;
  iban?: string;
};

export type MonobankClientInfo = {
  accounts?: MonobankAccount[];
  managedClients?: { accounts?: MonobankAccount[] }[];
};

/** Операція з виписки; суми в копійках, час у секундах Unix. */
export type MonobankStatementItem = {
  id: string;
  time: number;
  description?: string;
  amount: number;
  operationAmount?: number;
  currencyCode?: number;
  comment?: string;
  counterName?: string;
  counterIban?: string;
};

type CallOptions = {
  token?: string | null;
  fetchImpl?: typeof fetch;
  /** Підміна пауз між повторами (тести). */
  retryDelaysMs?: number[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeLog(
  db: AnyPgDatabase | null,
  entry: {
    operation: string;
    status: number | null;
    durationMs: number;
    count: number | null;
    errorText: string | null;
  },
): Promise<void> {
  if (!db) return;
  try {
    await db.insert(integrationLogs).values({
      service: "monobank",
      operation: entry.operation,
      request: null,
      response: entry.count === null ? null : { count: entry.count },
      status: entry.status,
      durationMs: entry.durationMs,
      errorText: entry.errorText,
    });
  } catch {
    // Збій запису в журнал не повинен ламати виклик.
  }
}

const httpMessage = (status: number): string =>
  status === 403
    ? "monobank відхилив токен. Перевірте або замініть ключ."
    : status === 429
      ? "monobank просить зачекати: забагато запитів."
      : `monobank відповів помилкою (код ${status}).`;

async function call<T>(
  db: AnyPgDatabase | null,
  path: string,
  operation: string,
  options: CallOptions,
): Promise<T> {
  const token = options.token === undefined ? getMonobankToken() : options.token;
  if (!token) {
    throw new MonobankError("Токен monobank не налаштовано. Додайте MONOPAY_API_KEY на сервері.");
  }
  const doFetch = options.fetchImpl ?? fetch;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const started = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await doFetch(`${MONOBANK_API_URL}${path}`, {
        headers: { "X-Token": token },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      const text =
        error instanceof Error && error.name === "TimeoutError"
          ? "monobank не відповів вчасно."
          : "Немає зв'язку з monobank.";
      if (attempt < MAX_ATTEMPTS) {
        await sleep(delays[attempt - 1] ?? 0);
        continue;
      }
      await writeLog(db, {
        operation,
        status: null,
        durationMs: Date.now() - started,
        count: null,
        errorText: text,
      });
      throw new MonobankError(text);
    }

    if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(delays[attempt - 1] ?? 0);
      continue;
    }
    if (!response.ok) {
      const text = httpMessage(response.status);
      await writeLog(db, {
        operation,
        status: response.status,
        durationMs: Date.now() - started,
        count: null,
        errorText: text,
      });
      throw new MonobankError(text, response.status);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      await writeLog(db, {
        operation,
        status: response.status,
        durationMs: Date.now() - started,
        count: null,
        errorText: "Некоректна відповідь monobank.",
      });
      throw new MonobankError("Некоректна відповідь monobank.", response.status);
    }
    await writeLog(db, {
      operation,
      status: response.status,
      durationMs: Date.now() - started,
      count: Array.isArray(data) ? data.length : 1,
      errorText: null,
    });
    return data as T;
  }
  throw new MonobankError("Немає зв'язку з monobank.");
}

/** Рахунки власника токена (раз на добу). */
export const fetchClientInfo = (db: AnyPgDatabase | null, options: CallOptions = {}) =>
  call<MonobankClientInfo>(db, "/personal/client-info", "client-info", options);

/** Виписка за вікно не більше 31 дня; не частіше одного запиту на 60 с на рахунок. */
export const fetchStatement = (
  db: AnyPgDatabase | null,
  accountId: string,
  from: Date,
  to: Date,
  options: CallOptions = {},
) =>
  call<MonobankStatementItem[]>(
    db,
    `/personal/statement/${encodeURIComponent(accountId)}/${Math.floor(from.getTime() / 1000)}/${Math.floor(to.getTime() / 1000)}`,
    "statement",
    options,
  );
