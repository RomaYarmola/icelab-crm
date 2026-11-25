/**
 * Стан панелі аналітики в адресі (B14): період «від місяця» й «до місяця». Некоректні значення
 * замінюються на типові (останні 6 місяців), задовгий період обрізається до 24 місяців, тож ручна
 * правка адреси не ламає екран.
 */

export const ANALYTICS_PARAMS = { from: "from", to: "to" } as const;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DEFAULT_SPAN = 6;
const MAX_SPAN = 24;

const shift = (month: string, delta: number): string => {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (mon - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parseAnalyticsParams(raw: RawParams, today: string): { from: string; to: string } {
  const current = today.slice(0, 7);
  const rawTo = first(raw[ANALYTICS_PARAMS.to]);
  const to = rawTo && MONTH.test(rawTo) ? rawTo : current;
  const rawFrom = first(raw[ANALYTICS_PARAMS.from]);
  let from = rawFrom && MONTH.test(rawFrom) ? rawFrom : shift(to, -(DEFAULT_SPAN - 1));
  if (from > to) from = to;
  if (from < shift(to, -(MAX_SPAN - 1))) from = shift(to, -(MAX_SPAN - 1));
  return { from, to };
}
