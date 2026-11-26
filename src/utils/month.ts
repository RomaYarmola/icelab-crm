/** Місяці у вигляді `YYYY-MM`. Чисті функції. */

/** Місяць через `by` місяців: «2026-01» мінус один це «2025-12». */
export function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1 + by, 1)).toISOString().slice(0, 7);
}
