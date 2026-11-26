import { z } from "zod";
import { integrationLogs } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * Клієнт API IBAN oplata (B13, D239; docs/ibanoplata-api.md): список збережених реквізитів і
 * створення посилання на оплату. Ключ лише у змінній `IBANOPLATA_API_KEY` на сервері; у базі,
 * журналах і відповідях його немає. Створення посилання не повторюємо: захисту від дублів у
 * сервісі немає. У `integration_logs` пишемо виклик без ключа, реквізитів і сум.
 */

export const IBANOPLATA_API_URL = "https://api.ibanoplata.com";
const TIMEOUT_MS = 10_000;

export function getIbanOplataKey(): string | null {
  return process.env.IBANOPLATA_API_KEY?.trim() || null;
}

export class IbanOplataError extends Error {
  /** HTTP-статус відповіді; `null`, якщо відповіді не було (мережа, таймаут). */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "IbanOplataError";
    this.status = status;
  }
}

const accountSchema = z.object({
  ibanAccountUid: z.string().min(1),
  organizationName: z.string(),
  identificationCode: z.string(),
  iban: z.string(),
  isSuspended: z.boolean(),
});
export type IbanAccount = z.infer<typeof accountSchema>;

const createdSchema = z.object({
  ibanInvoiceUid: z.string().min(1),
  ibanInvoiceUrl: z.url({ protocol: /^https$/ }),
});

export type CallOptions = { key?: string | null; fetchImpl?: typeof fetch };

const httpMessage = (status: number): string =>
  status === 401 || status === 403
    ? "IBAN oplata відхилив ключ: перевірте його й передплату в кабінеті сервісу."
    : status === 422 || status === 400
      ? "IBAN oplata не прийняв дані посилання. Перевірте реквізити в кабінеті сервісу."
      : status === 429
        ? "IBAN oplata просить зачекати: забагато запитів."
        : `IBAN oplata відповів помилкою (код ${status}).`;

async function writeLog(
  db: AnyPgDatabase,
  entry: { operation: string; status: number | null; durationMs: number; errorText: string | null },
) {
  try {
    await db.insert(integrationLogs).values({
      service: "ibanoplata",
      operation: entry.operation,
      request: null,
      response: null,
      status: entry.status,
      durationMs: entry.durationMs,
      errorText: entry.errorText,
    });
  } catch {
    // Збій запису в журнал не повинен ламати виклик.
  }
}

async function call<T>(
  db: AnyPgDatabase,
  operation: string,
  path: string,
  schema: z.ZodType<T>,
  options: CallOptions,
  body?: unknown,
): Promise<T> {
  const key = options.key === undefined ? getIbanOplataKey() : options.key;
  if (!key) {
    throw new IbanOplataError(
      "Ключ IBAN oplata не налаштовано. Додайте IBANOPLATA_API_KEY на сервері.",
    );
  }
  const doFetch = options.fetchImpl ?? fetch;
  const started = Date.now();
  let status: number | null = null;
  try {
    let response: Response;
    try {
      response = await doFetch(`${IBANOPLATA_API_URL}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "X-Api-Key": key,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      throw new IbanOplataError(
        error instanceof Error && error.name === "TimeoutError"
          ? "IBAN oplata не відповів вчасно."
          : "Немає зв'язку з IBAN oplata.",
      );
    }
    status = response.status;
    if (!response.ok) throw new IbanOplataError(httpMessage(status), status);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new IbanOplataError("IBAN oplata відповів у незрозумілому форматі.", status);
    }
    await writeLog(db, { operation, status, durationMs: Date.now() - started, errorText: null });
    return parsed.data;
  } catch (error) {
    await writeLog(db, {
      operation,
      status,
      durationMs: Date.now() - started,
      errorText: error instanceof IbanOplataError ? error.message : "Невідома помилка",
    });
    throw error;
  }
}

/** Реквізити, збережені в кабінеті сервісу. */
export function listIbanAccounts(db: AnyPgDatabase, options: CallOptions = {}) {
  return call(db, "iban-account", "/v2/iban-account", z.array(accountSchema), options);
}

export type NewInvoice = {
  organizationName: string;
  identificationCode: string;
  iban: string;
  /** Гривні з копійками. */
  amount: number;
  paymentPurpose: string;
};

export function createIbanInvoice(
  db: AnyPgDatabase,
  invoice: NewInvoice,
  options: CallOptions = {},
) {
  return call(db, "iban-invoice", "/v2/iban-invoice", createdSchema, options, invoice);
}
