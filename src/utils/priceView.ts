import type { ClientPriceHistoryItem, DefaultPriceHistoryItem } from "@/server/prices";
import { formatIsoDate } from "./isoDate";

/**
 * Ціни для показу на екранах: яка ціна діє зараз, яка настане пізніше, як згрупувати історію.
 * Правило вибору те саме, що в `resolvePrice` (D45): індивідуальна на цей тип льоду, інакше
 * індивідуальна «для будь-якого типу», інакше прайс. Чисті функції без бази.
 */

export const ANY_ICE_TYPE_LABEL = "Для будь-якого типу";

type PriceLike = { pricePerKg: string; validFrom: string; validTo: string | null };

/** Діє на дату: почалась і ще не закінчилась (останній день включно). */
export function isActiveOn(price: PriceLike, date: string): boolean {
  return price.validFrom <= date && (price.validTo === null || price.validTo >= date);
}

/** Ще не почала діяти. */
export function isUpcoming(price: PriceLike, date: string): boolean {
  return price.validFrom > date;
}

/**
 * Період дії ціни словами для історії: «з 01.10.2026, діє зараз», «01.09.2026 – 30.09.2026»,
 * «з 01.12.2026, ще не діє». Дати у вигляді 12.11.2026.
 */
export function describePeriod(price: PriceLike, date: string): string {
  const period = price.validTo
    ? `${formatIsoDate(price.validFrom)} – ${formatIsoDate(price.validTo)}`
    : `з ${formatIsoDate(price.validFrom)}`;
  if (isUpcoming(price, date)) return `${period}, ще не діє`;
  if (isActiveOn(price, date)) return `${period}, діє зараз`;
  return period;
}

export type PriceSource = "client" | "client_any_type" | "default" | "none";

export type EffectivePrice = {
  source: PriceSource;
  /** Ціна, що діє зараз (`null`, якщо її немає ніде). */
  current: { pricePerKg: string; validFrom: string } | null;
  /** Найближча ціна, що настане пізніше (на цьому чи вищому рівні), або перша, якщо діючої немає. */
  upcoming: { pricePerKg: string; validFrom: string } | null;
};

const byEarliestStart = (a: PriceLike, b: PriceLike) => a.validFrom.localeCompare(b.validFrom);

function pick(rows: PriceLike[], date: string) {
  const current =
    rows
      .filter((row) => isActiveOn(row, date))
      .sort(byEarliestStart)
      .at(-1) ?? null;
  const upcoming = rows.filter((row) => isUpcoming(row, date)).sort(byEarliestStart)[0] ?? null;
  const view = (row: PriceLike | null) =>
    row ? { pricePerKg: row.pricePerKg, validFrom: row.validFrom } : null;
  return { current: view(current), upcoming: view(upcoming) };
}

/**
 * Яка ціна діє для типу льоду на дату. `clientPrices` це вся історія цін клієнта, `defaults` вся
 * історія прайсу (будь-яких типів), зайве відсікається тут.
 */
export function effectivePriceFor(
  iceTypeId: string,
  clientPrices: ClientPriceHistoryItem[],
  defaults: DefaultPriceHistoryItem[],
  date: string,
): EffectivePrice {
  const levels: { source: Exclude<PriceSource, "none">; rows: PriceLike[] }[] = [
    { source: "client", rows: clientPrices.filter((row) => row.iceTypeId === iceTypeId) },
    { source: "client_any_type", rows: clientPrices.filter((row) => row.iceTypeId === null) },
    { source: "default", rows: defaults.filter((row) => row.iceTypeId === iceTypeId) },
  ];

  // Майбутня ціна важлива, якщо вона з'явиться на рівні не нижчому за той, що діє зараз: наприклад,
  // клієнту з прайсом завтра встановили свою ціну. Ціни нижчого рівня її не перекриють.
  const earliest = (rows: { pricePerKg: string; validFrom: string }[]) =>
    [...rows].sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0] ?? null;

  const picks = levels.map((level) => ({ source: level.source, ...pick(level.rows, date) }));
  const winnerIndex = picks.findIndex((entry) => entry.current !== null);
  if (winnerIndex !== -1) {
    const upcoming = earliest(
      picks.slice(0, winnerIndex + 1).flatMap((entry) => (entry.upcoming ? [entry.upcoming] : [])),
    );
    return { source: picks[winnerIndex]!.source, current: picks[winnerIndex]!.current, upcoming };
  }
  // Діючої ціни немає: показуємо хоча б найближчу майбутню.
  const upcoming = earliest(picks.flatMap((entry) => (entry.upcoming ? [entry.upcoming] : [])));
  if (upcoming) return { source: "none", current: null, upcoming };
  return { source: "none", current: null, upcoming: null };
}

export type PriceGroup<T> = { key: string; title: string; rows: T[] };

/**
 * Історія цін клієнта за типами льоду: у кожній групі від новішої ціни до старішої. Групи стоять
 * у порядку, у якому типи зустрілись у списку (сервер уже впорядкував їх за довідником).
 */
export function groupClientPrices(
  rows: ClientPriceHistoryItem[],
): PriceGroup<ClientPriceHistoryItem>[] {
  const groups = new Map<string, PriceGroup<ClientPriceHistoryItem>>();
  for (const row of rows) {
    const key = row.iceTypeId ?? "any";
    const group = groups.get(key) ?? {
      key,
      title: row.iceTypeName ?? ANY_ICE_TYPE_LABEL,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  }));
}

/** Те саме для прайсу: групи за типами льоду. */
export function groupDefaultPrices(
  rows: DefaultPriceHistoryItem[],
): PriceGroup<DefaultPriceHistoryItem>[] {
  const groups = new Map<string, PriceGroup<DefaultPriceHistoryItem>>();
  for (const row of rows) {
    const group = groups.get(row.iceTypeId) ?? {
      key: row.iceTypeId,
      title: row.iceTypeName,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.iceTypeId, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  }));
}
