import { ORDER_STATUS_ORDER } from "@/constants/orders";
import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import { addDays, isIsoDate } from "./isoDate";

/**
 * Стан списку замовлень в адресі сторінки (D47, D56): день, діапазон дат, статус, менеджер,
 * спосіб доставки й пошук живуть у параметрах адреси, тож посиланням можна поділитись, а «Назад»
 * повертає до того самого списку. Чисті функції.
 */

export const ORDER_LIST_PARAMS = {
  day: "day",
  from: "from",
  to: "to",
  status: "status",
  manager: "manager",
  delivery: "delivery",
  search: "q",
} as const;

export const DAY_PRESETS = ["yesterday", "today", "tomorrow", "week"] as const;
export type DayPreset = (typeof DAY_PRESETS)[number];

export const DAY_PRESET_LABELS: Record<DayPreset, string> = {
  yesterday: "Вчора",
  today: "Сьогодні",
  tomorrow: "Завтра",
  week: "Тиждень",
};

export const MAX_SEARCH_LENGTH = 100;

export type OrderListFilters = {
  /** Вибраний день або «range», якщо дати вказано вручну. */
  day: DayPreset | "range";
  dateFrom: string;
  dateTo: string;
  status: string;
  managerId: string;
  deliveryMethod: string;
  search: string;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Тиждень поточної дати: з понеділка по неділю (дати `YYYY-MM-DD`). */
export function weekRange(today: string): { from: string; to: string } {
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = неділя
  const sinceMonday = (weekday + 6) % 7;
  const from = addDays(today, -sinceMonday);
  return { from, to: addDays(from, 6) };
}

/** Діапазон дат вибраного дня: «Вчора», «Сьогодні», «Завтра» це один день, «Тиждень» понеділок-неділя. */
export function dayRange(preset: DayPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 1) };
    case "week":
      return weekRange(today);
    default:
      return { from: today, to: today };
  }
}

/**
 * Параметри адреси сторінки (`searchParams`) у фільтри списку. Без параметрів показуємо сьогодні.
 * Вручну вказані дати сильніші за вибраний день; перевернутий діапазон розвертається. Сміття
 * (невідомий день, статус, не-uuid менеджер) відкидається, а не ламає сторінку.
 */
export function parseOrderListParams(params: RawParams, today: string): OrderListFilters {
  const from = first(params[ORDER_LIST_PARAMS.from]);
  const to = first(params[ORDER_LIST_PARAMS.to]);
  const validFrom = isIsoDate(from) ? from : "";
  const validTo = isIsoDate(to) ? to : "";

  let day: OrderListFilters["day"];
  let dateFrom: string;
  let dateTo: string;
  if (validFrom || validTo) {
    day = "range";
    dateFrom = validFrom;
    dateTo = validTo;
    if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  } else {
    const requested = first(params[ORDER_LIST_PARAMS.day]);
    day = (DAY_PRESETS as readonly string[]).includes(requested)
      ? (requested as DayPreset)
      : "today";
    ({ from: dateFrom, to: dateTo } = dayRange(day, today));
  }

  const status = first(params[ORDER_LIST_PARAMS.status]);
  const manager = first(params[ORDER_LIST_PARAMS.manager]);
  const delivery = first(params[ORDER_LIST_PARAMS.delivery]);

  return {
    day,
    dateFrom,
    dateTo,
    status: (ORDER_STATUS_ORDER as readonly string[]).includes(status) ? status : "",
    managerId: UUID_PATTERN.test(manager) ? manager : "",
    deliveryMethod: delivery in DELIVERY_METHOD_LABELS ? delivery : "",
    search: first(params[ORDER_LIST_PARAMS.search]).trim().slice(0, MAX_SEARCH_LENGTH),
  };
}

/** Скільки фільтрів увімкнено (день і пошук не рахуємо: вони мають власні елементи). */
export function countActiveFilters(filters: OrderListFilters): number {
  return [filters.status, filters.managerId, filters.deliveryMethod].filter(Boolean).length;
}

/** Є пошук чи фільтр: від цього залежить текст порожнього стану. День за замовчуванням не рахуємо. */
export function hasActiveSearch(filters: OrderListFilters): boolean {
  return filters.search !== "" || countActiveFilters(filters) > 0 || filters.day === "range";
}
