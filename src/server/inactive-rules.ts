/**
 * Правила «давно не замовляли» (B14, ТЗ 7.7, D207). Чисті функції без бази. Поріг це кількість днів
 * без замовлення, після якої клієнт потрапляє в список і отримує нагадування.
 */

export const DEFAULT_INACTIVE_DAYS = 30;
/** Скільки останніх замовлень беремо для «ритму» клієнта. */
export const RHYTHM_ORDERS = 6;
/** Менше трьох днів із замовленнями ритму не дають. */
const MIN_RHYTHM_DATES = 3;

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** Скільки днів минуло від `from` до `to` (дати `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Поріг «від ритму»: 2 × медіана проміжків між останніми шістьма днями із замовленнями. Кілька
 * замовлень одного дня це один день. Якщо днів менше трьох, ритму немає.
 */
export function rhythmThreshold(orderDates: readonly string[]): number | null {
  const dates = [...new Set(orderDates)].sort().slice(-RHYTHM_ORDERS);
  if (dates.length < MIN_RHYTHM_DATES) return null;
  const gaps = dates.slice(1).map((date, index) => daysBetween(dates[index]!, date));
  return Math.round(2 * median(gaps));
}

export type Threshold = {
  days: number;
  /** Звідки поріг: заданий у картці клієнта, «від ритму» чи загальний. */
  source: "client" | "rhythm" | "default";
};

/**
 * Який поріг діє для клієнта. Заданий у картці вручну перемагає все. Інакше загальний, а в
 * регулярного клієнта з рідшим ритмом поріг «від ритму» (ніколи не менший за загальний).
 */
export function inactiveThreshold(
  own: number | null,
  orderDates: readonly string[],
  general: number = DEFAULT_INACTIVE_DAYS,
): Threshold {
  if (own !== null) return { days: own, source: "client" };
  const rhythm = rhythmThreshold(orderDates);
  return rhythm !== null && rhythm > general
    ? { days: rhythm, source: "rhythm" }
    : { days: general, source: "default" };
}
