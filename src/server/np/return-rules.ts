/** Правила повернень боксів Новою Поштою (B17, D222, D223): чисті функції без бази. */

import { APP_TIME_ZONE } from "@/utils/formatDate";

/** Скільки днів від створення відправки чекаємо на «легке повернення» (D222). */
export const RETURN_WINDOW_DAYS = 90;
/** Ту саму відправку без повернення перепитуємо не частіше ніж раз на стільки годин (D222). */
export const RECHECK_HOURS = 3;

/** Номер накладної повернення з відповіді трекінгу; `null`, якщо повернення немає. */
export function lightReturnNumber(value: unknown, ownNumber: string): string | null {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d{14}$/.test(text) && text !== ownNumber ? text : null;
}

/** Зсув Києва від UTC у мілісекундах для заданого моменту. */
function kyivOffset(at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return (
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) -
    at
  );
}

/**
 * Дата Нової Пошти («2026-11-25 09:59:42», «25.11.2026 16:06:49», «24-11-2026 09:59:19») у момент
 * часу; пояс київський. Порожнє чи «0001-01-01» дає `null`.
 */
export function parseNpDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  const local = /^(\d{2})[.-](\d{2})[.-](\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  const found = iso ?? local;
  if (!found) return null;
  const year = Number(iso ? found[1] : found[3]);
  const month = Number(found[2]);
  const day = Number(iso ? found[3] : found[1]);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const wall = Date.UTC(
    year,
    month - 1,
    day,
    Number(found[4] ?? 0),
    Number(found[5] ?? 0),
    Number(found[6] ?? 0),
  );
  // Другий крок виправляє зсув біля переходу на літній чи зимовий час.
  const first = wall - kyivOffset(wall);
  return new Date(wall - kyivOffset(first));
}

/** Чий це список (D223): локація з назвою міста отримання, інакше локація відправки. */
export function returnLocationId(
  city: string | null,
  locations: readonly { id: string; name: string }[],
  shipmentLocationId: string,
): string {
  const wanted = city?.trim().toLocaleLowerCase("uk");
  const match = locations.find((location) => location.name.toLocaleLowerCase("uk") === wanted);
  return match?.id ?? shipmentLocationId;
}
