import { integrationLogs } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { getNpApiKey, NpError } from "./client";

/**
 * Стікер накладної (PDF 100×100) від Нової Пошти (B10, D122, ТЗ 8.4). Адреса друку містить ключ у
 * шляху, тому завантажує її лише сервер: у браузер, у журнал викликів і в помилки потрапляє лише
 * готовий PDF чи текст без адреси.
 */

const STICKER_HOST = "https://my.novaposhta.ua";
const TIMEOUT_MS = 20_000;

/** Адреса друку стікера. Лише для сервера: містить ключ. */
export function stickerUrl(npRef: string, apiKey: string): string {
  return `${STICKER_HOST}/orders/printMarking100x100/orders[]/${encodeURIComponent(npRef)}/type/pdf/apiKey/${encodeURIComponent(apiKey)}`;
}

type Options = { apiKey?: string | null; fetchImpl?: typeof fetch };

async function log(
  db: AnyPgDatabase | null,
  entry: { status: number | null; durationMs: number; errorText: string | null; npRef: string },
): Promise<void> {
  if (!db) return;
  try {
    await db.insert(integrationLogs).values({
      service: "np",
      operation: "printMarking100x100",
      request: { ref: entry.npRef },
      response: null,
      status: entry.status,
      durationMs: entry.durationMs,
      errorText: entry.errorText,
    });
  } catch {
    // Журнал не повинен ламати видачу стікера.
  }
}

/** Завантажує PDF стікера однієї накладної. Кидає `NpError` з текстом без адреси й ключа. */
export async function fetchStickerPdf(
  db: AnyPgDatabase | null,
  npRef: string,
  options: Options = {},
): Promise<Uint8Array> {
  const apiKey = options.apiKey === undefined ? getNpApiKey() : options.apiKey;
  if (!apiKey) {
    throw new NpError("Ключ Нової Пошти не налаштовано. Додайте його в змінні середовища сервера.");
  }
  const started = Date.now();
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(stickerUrl(npRef, apiKey), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    await log(db, { status: null, durationMs: Date.now() - started, errorText: "мережа", npRef });
    throw new NpError("Немає зв'язку з Новою Поштою. Спробуйте ще раз.", { isNetwork: true });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // PDF починається з «%PDF»; інакше Нова Пошта віддала сторінку з помилкою.
  const isPdf = bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF";
  if (!response.ok || !isPdf) {
    const errorText = `Нова Пошта не віддала стікер (код ${response.status}).`;
    await log(db, { status: response.status, durationMs: Date.now() - started, errorText, npRef });
    throw new NpError(errorText);
  }
  await log(db, {
    status: response.status,
    durationMs: Date.now() - started,
    errorText: null,
    npRef,
  });
  return bytes;
}
