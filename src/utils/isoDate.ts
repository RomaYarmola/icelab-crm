import { APP_TIME_ZONE } from "./formatDate";

/**
 * Дати без часу у вигляді `YYYY-MM-DD` (так їх віддає колонка `date` у базі). Дні рахуємо в UTC,
 * щоб перехід на літній час не зсував дату. Чисті функції.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Чи рядок це існуюча календарна дата (31 лютого не проходить). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Дата через `days` днів (від'ємне число дає раніше): `addDays("2026-03-01", -1)` це «2026-02-28». */
export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new Error(`Некоректна дата: ${isoDate}`);
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

/** Сьогоднішня дата за київським часом у вигляді `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  // Шведський формат дає саме YYYY-MM-DD.
  return new Intl.DateTimeFormat("sv-SE", { timeZone: APP_TIME_ZONE }).format(now);
}

/** Дата для показу: `2026-11-12` дає «12.11.2026». */
export function formatIsoDate(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
}
