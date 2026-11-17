import { integrationLogs } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * Клієнт API Нової Пошти 2.0 (B10, D122, D123, ТЗ 8.4): один POST-запит на метод. Таймаут 15 секунд,
 * повтор лише на мережевих помилках (обрив, таймаут), текст помилки Нової Пошти повертаємо як є
 * українською. Кожен виклик пишемо в `integration_logs` без ключа й без самих даних відповіді (лише
 * кількість записів, помилки й попередження): довідники великі, а персональні дані в журнал не йдуть.
 */

export const NP_API_URL = "https://api.novaposhta.ua/v2.0/json/";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

/** Ключ лише зі змінних середовища сервера; у базі, журналах і браузері його немає. */
export function getNpApiKey(): string | null {
  return process.env.NOVA_POSHTA_API_KEY?.trim() || null;
}

/** Помилка виклику Нової Пошти: текст призначений користувачеві. */
export class NpError extends Error {
  /** `true`, якщо відповіді не було (мережа, таймаут). */
  readonly isNetwork: boolean;
  readonly errors: string[];

  constructor(message: string, options: { isNetwork?: boolean; errors?: string[] } = {}) {
    super(message);
    this.name = "NpError";
    this.isNetwork = options.isNetwork ?? false;
    this.errors = options.errors ?? [];
  }
}

export type NpCall = {
  modelName: string;
  calledMethod: string;
  methodProperties?: Record<string, unknown>;
};

export type NpResult<T> = {
  data: T[];
  warnings: string[];
};

type NpRawResponse = {
  success?: boolean;
  data?: unknown;
  errors?: unknown;
  warnings?: unknown;
  errorCodes?: unknown;
};

type CallOptions = {
  /** Підміна ключа й `fetch` для тестів. */
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  /** Без повторів і пауз (тести). */
  retryDelayMs?: number;
};

const textList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];

/** Прибирає ключ з об'єкта будь-якої вкладеності: у журнал він потрапити не може. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        /api[_-]?key/i.test(key) ? "[прибрано]" : redactSecrets(item),
      ]),
    );
  }
  return value;
}

async function writeLog(
  db: AnyPgDatabase | null,
  entry: {
    call: NpCall;
    status: number | null;
    durationMs: number;
    response: unknown;
    errorText: string | null;
  },
): Promise<void> {
  if (!db) return;
  try {
    await db.insert(integrationLogs).values({
      service: "np",
      operation: `${entry.call.modelName}/${entry.call.calledMethod}`,
      request: redactSecrets({ methodProperties: entry.call.methodProperties ?? {} }) as object,
      response: entry.response as object | null,
      status: entry.status,
      durationMs: entry.durationMs,
      errorText: entry.errorText,
    });
  } catch {
    // Збій запису в журнал не повинен ламати сам виклик.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Викликає метод API. Кидає `NpError`: без ключа, при мережевій помилці після повторів, при
 * `success: false` (текст з `errors[]`). `warnings[]` повертає разом з даними.
 */
export async function callNp<T = Record<string, unknown>>(
  db: AnyPgDatabase | null,
  call: NpCall,
  options: CallOptions = {},
): Promise<NpResult<T>> {
  const apiKey = options.apiKey === undefined ? getNpApiKey() : options.apiKey;
  if (!apiKey) {
    throw new NpError("Ключ Нової Пошти не налаштовано. Додайте його в змінні середовища сервера.");
  }
  const doFetch = options.fetchImpl ?? fetch;
  const delay = options.retryDelayMs ?? RETRY_DELAY_MS;
  const body = JSON.stringify({
    apiKey,
    modelName: call.modelName,
    calledMethod: call.calledMethod,
    methodProperties: call.methodProperties ?? {},
  });

  const started = Date.now();
  let lastNetworkError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await doFetch(NP_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      lastNetworkError =
        error instanceof Error && error.name === "TimeoutError"
          ? "Нова Пошта не відповіла вчасно."
          : "Немає зв'язку з Новою Поштою.";
      if (attempt < MAX_ATTEMPTS) {
        await sleep(delay * attempt);
        continue;
      }
      await writeLog(db, {
        call,
        status: null,
        durationMs: Date.now() - started,
        response: null,
        errorText: lastNetworkError,
      });
      throw new NpError(`${lastNetworkError} Спробуйте ще раз.`, { isNetwork: true });
    }

    let raw: NpRawResponse | null = null;
    try {
      raw = (await response.json()) as NpRawResponse;
    } catch {
      raw = null;
    }
    const errors = textList(raw?.errors);
    const warnings = textList(raw?.warnings);
    const data = Array.isArray(raw?.data) ? (raw.data as T[]) : [];
    const ok = response.ok && raw?.success === true;
    const errorText = ok
      ? null
      : errors.length > 0
        ? errors.join("; ")
        : `Нова Пошта відповіла помилкою (код ${response.status}).`;
    await writeLog(db, {
      call,
      status: response.status,
      durationMs: Date.now() - started,
      response: { success: ok, count: data.length, errors, warnings },
      errorText,
    });
    if (!ok) throw new NpError(errorText!, { errors });
    return { data, warnings };
  }
  // Недосяжно: цикл завжди повертає або кидає.
  throw new NpError("Немає зв'язку з Новою Поштою. Спробуйте ще раз.", { isNetwork: true });
}
