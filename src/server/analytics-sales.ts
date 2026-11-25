import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { boxTypes, clients, locations, orderItems, orders, profiles } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { monthRange } from "./analytics";
import { kopecksToUah, toKopecks } from "./cash-rules";
import { type AppUser, locationScope, requirePermission } from "./guards";
import { monthBounds, SUMMARY_STATUSES } from "./month-summary";

/**
 * Панелі «Продажі боксів» і «Доставки» (B14, вимога Романа 11.11.2026, Г3, D211). Ті самі правила, що
 * в загальній панелі: підтверджені замовлення за датою виконання. Бокси це позиції `box_sale` (лише
 * продаж, без прибутку); доставки це спосіб доставки замовлення й позиції `delivery` (платна
 * доставка, без витрат). Менеджер бачить загальні підсумки, а клієнтів і менеджерів лише своїх.
 */

export type DeliveryMethod = "pickup" | "our_delivery" | "np" | "bus" | "other";
/** Способи, що означають доставку (не самовивіз і не «ще не вибрано»). */
export const DELIVERY_METHODS_PAID: readonly DeliveryMethod[] = ["our_delivery", "np", "bus"];

export type BoxMetrics = { count: number; uah: string };
export type BoxSlice = BoxMetrics & { key: string; label: string };

export type BoxAnalytics = {
  from: string;
  to: string;
  ownOnly: boolean;
  totals: BoxMetrics;
  /** Частка боксів у виручці за період, відсотки з одним знаком; `null`, якщо виручки немає. */
  revenueShare: number | null;
  months: (BoxMetrics & { month: string })[];
  byType: BoxSlice[];
  byClient: BoxSlice[];
  byManager: BoxSlice[];
};

export type DeliveryCounts = Record<DeliveryMethod, number>;

export type DeliveryMonth = { month: string; counts: DeliveryCounts; paid: string };

export type DeliverySlice = {
  key: string;
  label: string;
  /** Замовлень із доставкою, усіх замовлень і сума платної доставки. */
  delivered: number;
  orders: number;
  paid: string;
};

export type DeliveryAnalytics = {
  from: string;
  to: string;
  ownOnly: boolean;
  orders: number;
  delivered: number;
  /** Частка замовлень із доставкою, відсотки; `null`, якщо замовлень немає. */
  deliveredShare: number | null;
  paid: string;
  counts: DeliveryCounts;
  months: DeliveryMonth[];
  byLocation: DeliverySlice[];
  byClient: DeliverySlice[];
  byManager: DeliverySlice[];
};

type Query = { from: string; to: string; locationId?: string | null };

const share = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

async function loadOrders(db: AnyPgDatabase, actor: AppUser, query: Query) {
  const scoped = locationScope(actor) ?? query.locationId ?? null;
  const where = and(
    isNull(orders.deletedAt),
    inArray(orders.status, [...SUMMARY_STATUSES]),
    gte(orders.orderDate, monthBounds(query.from).from),
    lte(orders.orderDate, monthBounds(query.to).to),
    ...(scoped ? [eq(orders.locationId, scoped)] : []),
  );
  const rows = await db
    .select({
      id: orders.id,
      orderDate: orders.orderDate,
      total: orders.total,
      deliveryMethod: orders.deliveryMethod,
      locationId: locations.id,
      locationName: locations.name,
      clientId: clients.id,
      clientName: clients.name,
      managerId: clients.managerId,
      managerName: profiles.fullName,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .innerJoin(locations, eq(locations.id, orders.locationId))
    .leftJoin(profiles, eq(profiles.id, clients.managerId))
    .where(where);
  return { rows, where };
}

async function loadItems(
  db: AnyPgDatabase,
  where: Awaited<ReturnType<typeof loadOrders>>["where"],
  kind: "box_sale" | "delivery",
) {
  return db
    .select({
      orderId: orderItems.orderId,
      qty: orderItems.qty,
      amount: orderItems.amount,
      boxTypeId: orderItems.boxTypeId,
      boxName: boxTypes.name,
      title: orderItems.title,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(boxTypes, eq(boxTypes.id, orderItems.boxTypeId))
    .where(and(where, eq(orderItems.kind, kind)));
}

function addBox(
  map: Map<string, { label: string; count: number; kopecks: number }>,
  key: string,
  label: string,
  count: number,
  kopecks: number,
) {
  const entry = map.get(key) ?? { label, count: 0, kopecks: 0 };
  entry.count += count;
  entry.kopecks += kopecks;
  map.set(key, entry);
}

const boxRows = (map: Map<string, { label: string; count: number; kopecks: number }>): BoxSlice[] =>
  [...map.entries()]
    .map(([key, e]) => ({ key, label: e.label, count: e.count, uah: kopecksToUah(e.kopecks) }))
    .sort((a, b) => Number(b.uah) - Number(a.uah) || a.label.localeCompare(b.label, "uk"));

export async function getBoxAnalytics(
  db: AnyPgDatabase,
  actor: AppUser,
  query: Query,
): Promise<BoxAnalytics> {
  requirePermission(actor, "analytics", "read");
  const months = monthRange(query.from, query.to);
  const ownOnly = actor.role === "manager";
  const { rows, where } = await loadOrders(db, actor, query);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = await loadItems(db, where, "box_sale");

  const perMonth = new Map(months.map((month) => [month, { count: 0, kopecks: 0 }]));
  const types = new Map<string, { label: string; count: number; kopecks: number }>();
  const byClient = new Map<string, { label: string; count: number; kopecks: number }>();
  const byManager = new Map<string, { label: string; count: number; kopecks: number }>();
  const total = { count: 0, kopecks: 0 };
  for (const item of items) {
    const order = byId.get(item.orderId);
    if (!order) continue;
    const count = Math.round(Number(item.qty));
    const kopecks = toKopecks(item.amount);
    total.count += count;
    total.kopecks += kopecks;
    const month = perMonth.get(order.orderDate.slice(0, 7));
    if (month) {
      month.count += count;
      month.kopecks += kopecks;
    }
    addBox(types, item.boxTypeId ?? item.title, item.boxName ?? item.title, count, kopecks);
    if (ownOnly && order.managerId !== actor.id) continue;
    addBox(byClient, order.clientId, order.clientName, count, kopecks);
    addBox(byManager, order.managerId ?? "—", order.managerName ?? "Не вказано", count, kopecks);
  }
  const revenue = rows.reduce((sum, row) => sum + toKopecks(row.total), 0);

  return {
    from: query.from,
    to: query.to,
    ownOnly,
    totals: { count: total.count, uah: kopecksToUah(total.kopecks) },
    revenueShare: share(total.kopecks, revenue),
    months: months.map((month) => {
      const value = perMonth.get(month)!;
      return { month, count: value.count, uah: kopecksToUah(value.kopecks) };
    }),
    byType: boxRows(types),
    byClient: boxRows(byClient),
    byManager: boxRows(byManager),
  };
}

const emptyCounts = (): DeliveryCounts => ({ pickup: 0, our_delivery: 0, np: 0, bus: 0, other: 0 });

export async function getDeliveryAnalytics(
  db: AnyPgDatabase,
  actor: AppUser,
  query: Query,
): Promise<DeliveryAnalytics> {
  requirePermission(actor, "analytics", "read");
  const months = monthRange(query.from, query.to);
  const ownOnly = actor.role === "manager";
  const { rows, where } = await loadOrders(db, actor, query);
  const items = await loadItems(db, where, "delivery");
  const paidByOrder = new Map<string, number>();
  for (const item of items) {
    paidByOrder.set(item.orderId, (paidByOrder.get(item.orderId) ?? 0) + toKopecks(item.amount));
  }

  type Acc = { label: string; delivered: number; orders: number; kopecks: number };
  const counts = emptyCounts();
  const perMonth = new Map(months.map((month) => [month, { counts: emptyCounts(), kopecks: 0 }]));
  const location = new Map<string, Acc>();
  const client = new Map<string, Acc>();
  const manager = new Map<string, Acc>();
  let delivered = 0;
  let paid = 0;

  const addTo = (
    map: Map<string, Acc>,
    key: string,
    label: string,
    isDelivery: boolean,
    kopecks: number,
  ) => {
    const entry = map.get(key) ?? { label, delivered: 0, orders: 0, kopecks: 0 };
    entry.orders += 1;
    entry.delivered += isDelivery ? 1 : 0;
    entry.kopecks += kopecks;
    map.set(key, entry);
  };

  for (const order of rows) {
    const method = order.deliveryMethod;
    const isDelivery = DELIVERY_METHODS_PAID.includes(method);
    const kopecks = paidByOrder.get(order.id) ?? 0;
    counts[method] += 1;
    delivered += isDelivery ? 1 : 0;
    paid += kopecks;
    const month = perMonth.get(order.orderDate.slice(0, 7));
    if (month) {
      month.counts[method] += 1;
      month.kopecks += kopecks;
    }
    addTo(location, order.locationId, order.locationName, isDelivery, kopecks);
    if (ownOnly && order.managerId !== actor.id) continue;
    addTo(client, order.clientId, order.clientName, isDelivery, kopecks);
    addTo(manager, order.managerId ?? "—", order.managerName ?? "Не вказано", isDelivery, kopecks);
  }

  const slices = (map: Map<string, Acc>): DeliverySlice[] =>
    [...map.entries()]
      .map(([key, e]) => ({
        key,
        label: e.label,
        delivered: e.delivered,
        orders: e.orders,
        paid: kopecksToUah(e.kopecks),
      }))
      .sort((a, b) => b.delivered - a.delivered || a.label.localeCompare(b.label, "uk"));

  return {
    from: query.from,
    to: query.to,
    ownOnly,
    orders: rows.length,
    delivered,
    deliveredShare: share(delivered, rows.length),
    paid: kopecksToUah(paid),
    counts,
    months: months.map((month) => {
      const value = perMonth.get(month)!;
      return { month, counts: value.counts, paid: kopecksToUah(value.kopecks) };
    }),
    byLocation: slices(location),
    byClient: slices(client).filter((row) => row.delivered > 0 || Number(row.paid) > 0),
    byManager: slices(manager),
  };
}
