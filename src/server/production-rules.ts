import type { OrderStatus } from "@/constants/constants";
import { parseDecimal } from "@/utils/orderMath";

/**
 * Правила екрана виробництва (D63, D65, D72): що входить у чергу, порядок карток, підсумок за типами
 * льоду, що відкриття екрана переводить у «У виробництві». Чисті функції без бази.
 */

/** Статуси, які бачить цех: підтверджені (чекають), у роботі, запаковані (готові до відправки). */
export const PRODUCTION_STATUSES = [
  "confirmed",
  "in_production",
  "packed",
] as const satisfies readonly OrderStatus[];

export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const isProductionStatus = (status: OrderStatus): status is ProductionStatus =>
  (PRODUCTION_STATUSES as readonly string[]).includes(status);

/**
 * Відкриття екрана виробництва на сьогодні переводить підтверджені замовлення в «У виробництві»
 * (ТЗ 5.1, D72). Один перемикач: `false` лишає лише ручне «Розпочати».
 */
export const AUTO_START_IN_PRODUCTION = true;

/** Хто відкриттям екрана запускає виробництво: цех і старший локації. Власник і менеджер лише дивляться. */
export const AUTO_START_ROLES = ["production", "location_lead"] as const;

/** Початок вікна доставки в хвилинах від півночі: «10:00-14:00» дає 600, «9-11» дає 540, без часу `null`. */
export function windowStartMinutes(timeWindow: string | null | undefined): number | null {
  if (!timeWindow) return null;
  const match = timeWindow.match(/(\d{1,2})(?:[:.](\d{2}))?/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export type QueueSortable = {
  status: OrderStatus;
  /** Нове: цех ще не бачив замовлення (D65). */
  isNew: boolean;
  timeWindow: string | null;
  number: number | null;
};

const byWindowThenNumber = (a: QueueSortable, b: QueueSortable): number => {
  const first = windowStartMinutes(a.timeWindow);
  const second = windowStartMinutes(b.timeWindow);
  // Замовлення без вікна часу йдуть після тих, що мають вікно.
  if (first !== second) {
    if (first === null) return 1;
    if (second === null) return -1;
    return first - second;
  }
  return (a.number ?? 0) - (b.number ?? 0);
};

/** Порядок карток (ТЗ 6.4, D63): спершу нові, потім за вікном доставки, виконані внизу. */
export function sortProductionQueue<T extends QueueSortable>(cards: readonly T[]): T[] {
  const rank = (card: T) => (card.status === "packed" ? 2 : card.isNew ? 0 : 1);
  return [...cards].sort((a, b) => rank(a) - rank(b) || byWindowThenNumber(a, b));
}

/** Нове замовлення: ще не бачене цехом і не запаковане. */
export function isNewForProduction(order: {
  status: OrderStatus;
  seenByProductionAt: Date | null;
}): boolean {
  return order.seenByProductionAt === null && order.status !== "packed";
}

export type SummarySource = {
  status: OrderStatus;
  iceTypeId: string | null;
  iceTypeName: string | null;
  kgToProduce: string | number;
};

export type IceSummary = {
  iceTypeId: string | null;
  iceTypeName: string;
  /** Усього на день, кг. */
  kgPlanned: number;
  /** Ще не запаковано, кг. */
  kgLeft: number;
  orders: number;
};

export type ProductionSummary = {
  byIce: IceSummary[];
  /** Скільки замовлень ще не розпочато («Підтверджено»). */
  notStarted: number;
  /** Скільки замовлень не запаковано. */
  notPacked: number;
};

const GRAMS = 1000;

/** Підсумок за типами льоду: скільки кг виготовити на день (цілими грамами, без дробових помилок). */
export function summarizeProduction(cards: readonly SummarySource[]): ProductionSummary {
  const groups = new Map<
    string,
    { source: SummarySource; total: number; left: number; n: number }
  >();
  let notStarted = 0;
  let notPacked = 0;
  for (const card of cards) {
    if (!isProductionStatus(card.status)) continue;
    const key = card.iceTypeId ?? "";
    const grams = Math.round(parseDecimal(card.kgToProduce) * GRAMS);
    const group = groups.get(key) ?? { source: card, total: 0, left: 0, n: 0 };
    group.total += grams;
    group.n += 1;
    if (card.status !== "packed") {
      group.left += grams;
      notPacked += 1;
    }
    if (card.status === "confirmed") notStarted += 1;
    groups.set(key, group);
  }
  const byIce = [...groups.values()]
    .map((group) => ({
      iceTypeId: group.source.iceTypeId,
      iceTypeName: group.source.iceTypeName ?? "Без типу льоду",
      kgPlanned: group.total / GRAMS,
      kgLeft: group.left / GRAMS,
      orders: group.n,
    }))
    .sort((a, b) => a.iceTypeName.localeCompare(b.iceTypeName, "uk", { numeric: true }));
  return { byIce, notStarted, notPacked };
}

/**
 * Які замовлення відкриття екрана переводить у «У виробництві» (D72): підтверджені, на сьогодні, і
 * лише коли екран відкрив цех чи старший локації.
 */
export function ordersToAutoStart<T extends { id: string; status: OrderStatus; orderDate: string }>(
  orders: readonly T[],
  today: string,
  role: string,
): T[] {
  if (!AUTO_START_IN_PRODUCTION) return [];
  if (!(AUTO_START_ROLES as readonly string[]).includes(role)) return [];
  return orders.filter((order) => order.status === "confirmed" && order.orderDate === today);
}

// ---------------------------------------------------------------------------------------------
// «Куди» на картці цеху (ТЗ 6.4)
// ---------------------------------------------------------------------------------------------

export type DeliveryPlaceSource = {
  deliveryMethod: "pickup" | "our_delivery" | "np" | "bus" | "other";
  /** Вільний текст з замовлення (для архіву й нестандартних випадків). */
  deliveryText: string | null;
  address: {
    cityText: string | null;
    addressText: string | null;
    npWarehouseNumber: string | null;
  } | null;
};

/**
 * Куди їде замовлення: «Самовивіз», для Нової Пошти місто й відділення, для доставки адреса. Телефон
 * отримувача цеху не показуємо (D63).
 */
export function describeDeliveryPlace(source: DeliveryPlaceSource): string {
  if (source.deliveryMethod === "pickup") return "Самовивіз";
  const free = source.deliveryText?.trim();
  if (free) return free;
  const { address } = source;
  if (!address) return "Адресу не вказано";
  const parts: string[] = [];
  if (address.cityText?.trim()) parts.push(address.cityText.trim());
  if (source.deliveryMethod === "np" && address.npWarehouseNumber?.trim()) {
    parts.push(`відділення №${address.npWarehouseNumber.trim()}`);
  }
  if (address.addressText?.trim()) parts.push(address.addressText.trim());
  return parts.length > 0 ? parts.join(", ") : "Адресу не вказано";
}
