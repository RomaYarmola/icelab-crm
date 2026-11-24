import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { cashEntries, clients, locations, orderItems, orders, paymentMatches } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { addDays } from "@/utils/isoDate";
import { kopecksToUah, toKopecks } from "./cash-rules";
import { ValidationError } from "./errors";
import { type AppUser, locationScope, requirePermission } from "./guards";

/**
 * Зведення за місяць (B13, ТЗ 6.10): по клієнтах кг, дохід по льоду, доставки, продаж боксів, інші
 * товари, разом, оплачено й борг; підсумки по локаціях. Дохід це сума замовлень місяця за
 * зафіксованими цінами (`orders.total`), без чернеток і скасованих. «Оплачено» це готівка й платежі
 * з банку (не більше суми замовлення); замовлення зі статусом «Оплачено» чи «Закрито» вважаємо
 * сплаченими повністю. Лише власник і бухгалтер (як екран «Оплати»).
 */

/** Замовлення, що входять у зведення: підтверджені й далі, без чернеток і скасованих. */
export const SUMMARY_STATUSES = [
  "confirmed",
  "in_production",
  "packed",
  "shipped",
  "paid",
  "closed",
] as const;

export type SummaryTotals = {
  orders: number;
  kg: string;
  ice: string;
  delivery: string;
  boxes: string;
  other: string;
  total: string;
  paid: string;
  debt: string;
};

export type ClientSummary = SummaryTotals & {
  clientId: string;
  clientName: string;
  clientCode: string;
};
export type LocationSummaryRow = SummaryTotals & { locationId: string; locationName: string };

export type MonthSummary = {
  /** Місяць `YYYY-MM`. */
  month: string;
  dateFrom: string;
  dateTo: string;
  locationId: string | null;
  clients: ClientSummary[];
  locations: LocationSummaryRow[];
  totals: SummaryTotals;
};

/** Перший і останній день місяця за рядком `YYYY-MM`. */
export function monthBounds(month: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationError("Некоректний місяць.");
  const from = `${month}-01`;
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const nextFirst =
    mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(nextFirst, -1) };
}

type Acc = {
  orders: number;
  kg: number;
  ice: number;
  delivery: number;
  boxes: number;
  other: number;
  total: number;
  paid: number;
};
const empty = (): Acc => ({
  orders: 0,
  kg: 0,
  ice: 0,
  delivery: 0,
  boxes: 0,
  other: 0,
  total: 0,
  paid: 0,
});

function finish(acc: Acc): SummaryTotals {
  return {
    orders: acc.orders,
    kg: (acc.kg / 1000).toFixed(3).replace(/\.?0+$/, ""),
    ice: kopecksToUah(acc.ice),
    delivery: kopecksToUah(acc.delivery),
    boxes: kopecksToUah(acc.boxes),
    other: kopecksToUah(acc.other),
    total: kopecksToUah(acc.total),
    paid: kopecksToUah(acc.paid),
    debt: kopecksToUah(Math.max(acc.total - acc.paid, 0)),
  };
}

function add(target: Acc, source: Acc) {
  for (const key of Object.keys(target) as (keyof Acc)[]) target[key] += source[key];
}

export async function getMonthSummary(
  db: AnyPgDatabase,
  actor: AppUser,
  query: { month: string; locationId?: string | null },
): Promise<MonthSummary> {
  requirePermission(actor, "bank_payments", "read");
  const { from, to } = monthBounds(query.month);
  const scoped = locationScope(actor) ?? query.locationId ?? null;

  const conditions = [
    isNull(orders.deletedAt),
    inArray(orders.status, [...SUMMARY_STATUSES]),
    gte(orders.orderDate, from),
    lte(orders.orderDate, to),
    ...(scoped ? [eq(orders.locationId, scoped)] : []),
  ];
  const where = and(...conditions);

  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      kg: orders.kgSold,
      total: orders.total,
      clientId: clients.id,
      clientName: clients.name,
      clientCode: clients.code,
      locationId: locations.id,
      locationName: locations.name,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .innerJoin(locations, eq(locations.id, orders.locationId))
    .where(where);

  const [items, cash, bank] = await Promise.all([
    db
      .select({
        orderId: orderItems.orderId,
        kind: orderItems.kind,
        sum: sql<string>`sum(${orderItems.amount})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(where)
      .groupBy(orderItems.orderId, orderItems.kind),
    db
      .select({ orderId: cashEntries.orderId, sum: sql<string>`sum(${cashEntries.amount})` })
      .from(cashEntries)
      .innerJoin(orders, eq(orders.id, cashEntries.orderId))
      .where(and(where, isNull(cashEntries.reversedAt)))
      .groupBy(cashEntries.orderId),
    db
      .select({ orderId: paymentMatches.orderId, sum: sql<string>`sum(${paymentMatches.amount})` })
      .from(paymentMatches)
      .innerJoin(orders, eq(orders.id, paymentMatches.orderId))
      .where(where)
      .groupBy(paymentMatches.orderId),
  ]);

  const byOrder = new Map<string, Record<string, number>>();
  for (const item of items) {
    const entry = byOrder.get(item.orderId) ?? {};
    entry[item.kind] = (entry[item.kind] ?? 0) + toKopecks(item.sum);
    byOrder.set(item.orderId, entry);
  }
  const received = new Map<string, number>();
  for (const item of [...cash, ...bank]) {
    received.set(item.orderId, (received.get(item.orderId) ?? 0) + toKopecks(item.sum));
  }

  const perClient = new Map<string, { id: string; name: string; code: string; acc: Acc }>();
  const perLocation = new Map<string, { name: string; acc: Acc }>();
  const grand = empty();
  for (const row of rows) {
    const kinds = byOrder.get(row.id) ?? {};
    const total = toKopecks(row.total);
    const settled = row.status === "paid" || row.status === "closed";
    const acc: Acc = {
      orders: 1,
      kg: Math.round(Number(row.kg) * 1000),
      ice: kinds.ice ?? 0,
      delivery: kinds.delivery ?? 0,
      boxes: kinds.box_sale ?? 0,
      other: kinds.other ?? 0,
      total,
      paid: settled ? total : Math.min(total, received.get(row.id) ?? 0),
    };
    const client = perClient.get(row.clientId) ?? {
      id: row.clientId,
      name: row.clientName,
      code: row.clientCode,
      acc: empty(),
    };
    add(client.acc, acc);
    perClient.set(row.clientId, client);
    const location = perLocation.get(row.locationId) ?? { name: row.locationName, acc: empty() };
    add(location.acc, acc);
    perLocation.set(row.locationId, location);
    add(grand, acc);
  }

  return {
    month: query.month,
    dateFrom: from,
    dateTo: to,
    locationId: scoped,
    clients: [...perClient.entries()]
      .map(([clientId, value]) => ({
        clientId,
        clientName: value.name,
        clientCode: value.code,
        ...finish(value.acc),
        _total: value.acc.total,
      }))
      .sort((a, b) => b._total - a._total || a.clientName.localeCompare(b.clientName, "uk"))
      .map(({ _total, ...rest }) => (void _total, rest)),
    locations: [...perLocation.entries()]
      .map(([locationId, value]) => ({
        locationId,
        locationName: value.name,
        ...finish(value.acc),
      }))
      .sort((a, b) => a.locationName.localeCompare(b.locationName, "uk")),
    totals: finish(grand),
  };
}
