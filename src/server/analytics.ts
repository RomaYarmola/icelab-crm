import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { clientApplications, clients, iceTypes, orders, orderSources, profiles } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { kopecksToUah, toKopecks } from "./cash-rules";
import { ValidationError } from "./errors";
import { type AppUser, locationScope, requirePermission } from "./guards";
import { monthBounds, SUMMARY_STATUSES } from "./month-summary";
import { seesOwnClientsOnly } from "./permissions";

/**
 * Панель аналітики (B14, ТЗ 6.11, D204, D205): кг і гривні по місяцях, по клієнтах із динамікою до
 * попереднього місяця й розрізи за менеджерами, типами льоду, застосуванням і джерелами. Рахуємо за
 * тими самими правилами, що й «Зведення за місяць»: підтверджені замовлення за датою виконання,
 * `orders.total` за зафіксованими цінами, кг це «кг на продаж». Менеджер бачить загальні підсумки,
 * а в таблиці клієнтів і розрізі «по менеджерах» лише свої дані (перевіряє сервер).
 */

export const MAX_MONTHS = 24;
export const DEFAULT_MONTHS = 6;

export type Metrics = { orders: number; kg: number; uah: string };
export type MonthPoint = Metrics & { month: string };
export type ClientRow = Metrics & {
  clientId: string;
  clientName: string;
  clientCode: string;
  /** Показники останнього місяця періоду й попереднього: для динаміки. */
  lastMonth: Metrics;
  previousMonth: Metrics;
};
export type SliceRow = Metrics & { key: string; label: string };

export type Analytics = {
  from: string;
  to: string;
  /** Менеджер бачить таблицю клієнтів і менеджерів лише зі своїми даними. */
  ownOnly: boolean;
  totals: Metrics;
  months: MonthPoint[];
  clients: ClientRow[];
  byManager: SliceRow[];
  byIceType: SliceRow[];
  byApplication: SliceRow[];
  bySource: SliceRow[];
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Місяць зі зсувом: `shiftMonth("2026-01", -1)` це «2025-12». */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (mon - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Усі місяці від `from` до `to` включно. */
export function monthRange(from: string, to: string): string[] {
  if (!MONTH.test(from) || !MONTH.test(to)) throw new ValidationError("Некоректний місяць.");
  if (from > to) throw new ValidationError("Початковий місяць пізніший за кінцевий.");
  const months: string[] = [];
  for (let month = from; month <= to; month = shiftMonth(month, 1)) {
    months.push(month);
    if (months.length > MAX_MONTHS) {
      throw new ValidationError(`Період не більше ${MAX_MONTHS} місяців.`);
    }
  }
  return months;
}

type Acc = { orders: number; grams: number; kopecks: number };
const empty = (): Acc => ({ orders: 0, grams: 0, kopecks: 0 });
const add = (acc: Acc, row: { grams: number; kopecks: number }) => {
  acc.orders += 1;
  acc.grams += row.grams;
  acc.kopecks += row.kopecks;
};
const metrics = (acc: Acc): Metrics => ({
  orders: acc.orders,
  kg: acc.grams / 1000,
  uah: kopecksToUah(acc.kopecks),
});

const NONE = "—";

export async function getAnalytics(
  db: AnyPgDatabase,
  actor: AppUser,
  query: { from: string; to: string; locationId?: string | null },
): Promise<Analytics> {
  requirePermission(actor, "analytics", "read");
  const months = monthRange(query.from, query.to);
  const ownOnly = seesOwnClientsOnly(actor);
  const lastMonth = query.to;
  const previousMonth = shiftMonth(lastMonth, -1);
  // Для динаміки потрібен і місяць перед останнім, навіть коли період складається з одного місяця.
  const firstNeeded = previousMonth < query.from ? previousMonth : query.from;
  const scoped = locationScope(actor) ?? query.locationId ?? null;

  const rows = await db
    .select({
      orderDate: orders.orderDate,
      kg: orders.kgSold,
      total: orders.total,
      clientId: clients.id,
      clientName: clients.name,
      clientCode: clients.code,
      managerId: clients.managerId,
      managerName: profiles.fullName,
      iceTypeId: orders.iceTypeId,
      iceTypeName: iceTypes.name,
      applicationId: clients.applicationId,
      applicationName: clientApplications.name,
      sourceId: orders.sourceId,
      sourceName: orderSources.name,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(profiles, eq(profiles.id, clients.managerId))
    .leftJoin(iceTypes, eq(iceTypes.id, orders.iceTypeId))
    .leftJoin(clientApplications, eq(clientApplications.id, clients.applicationId))
    .leftJoin(orderSources, eq(orderSources.id, orders.sourceId))
    .where(
      and(
        isNull(orders.deletedAt),
        inArray(orders.status, [...SUMMARY_STATUSES]),
        gte(orders.orderDate, monthBounds(firstNeeded).from),
        lte(orders.orderDate, monthBounds(query.to).to),
        ...(scoped ? [eq(orders.locationId, scoped)] : []),
      ),
    );

  const total = empty();
  const perMonth = new Map<string, Acc>(months.map((month) => [month, empty()]));
  const perClient = new Map<
    string,
    { name: string; code: string; period: Acc; last: Acc; previous: Acc }
  >();
  type Slice = Map<string, { label: string; acc: Acc }>;
  const slices: Record<"manager" | "ice" | "application" | "source", Slice> = {
    manager: new Map(),
    ice: new Map(),
    application: new Map(),
    source: new Map(),
  };
  const addSlice = (
    slice: Slice,
    key: string | null,
    label: string | null,
    row: { grams: number; kopecks: number },
  ) => {
    const id = key ?? NONE;
    let entry = slice.get(id);
    if (!entry) {
      entry = { label: label ?? "Не вказано", acc: empty() };
      slice.set(id, entry);
    }
    add(entry.acc, row);
  };

  for (const row of rows) {
    const month = row.orderDate.slice(0, 7);
    const value = { grams: Math.round(Number(row.kg) * 1000), kopecks: toKopecks(row.total) };
    const inPeriod = perMonth.has(month);
    const own = !ownOnly || row.managerId === actor.id;

    if (inPeriod) {
      add(total, value);
      add(perMonth.get(month)!, value);
      addSlice(slices.ice, row.iceTypeId, row.iceTypeName, value);
      addSlice(slices.application, row.applicationId, row.applicationName, value);
      addSlice(slices.source, row.sourceId, row.sourceName, value);
      if (own) addSlice(slices.manager, row.managerId, row.managerName, value);
    }
    if (!own) continue;
    let client = perClient.get(row.clientId);
    if (!client) {
      client = {
        name: row.clientName,
        code: row.clientCode,
        period: empty(),
        last: empty(),
        previous: empty(),
      };
      perClient.set(row.clientId, client);
    }
    if (inPeriod) add(client.period, value);
    if (month === lastMonth) add(client.last, value);
    if (month === previousMonth) add(client.previous, value);
  }

  const sliceRows = (slice: Slice): SliceRow[] =>
    [...slice.entries()]
      .map(([key, entry]) => ({ key, label: entry.label, ...metrics(entry.acc) }))
      .sort((a, b) => Number(b.uah) - Number(a.uah) || a.label.localeCompare(b.label, "uk"));

  return {
    from: query.from,
    to: query.to,
    ownOnly,
    totals: metrics(total),
    months: months.map((month) => ({ month, ...metrics(perMonth.get(month)!) })),
    clients: [...perClient.entries()]
      .filter(([, client]) => client.period.orders > 0)
      .map(([clientId, client]) => ({
        clientId,
        clientName: client.name,
        clientCode: client.code,
        ...metrics(client.period),
        lastMonth: metrics(client.last),
        previousMonth: metrics(client.previous),
      }))
      .sort(
        (a, b) => Number(b.uah) - Number(a.uah) || a.clientName.localeCompare(b.clientName, "uk"),
      ),
    byManager: sliceRows(slices.manager),
    byIceType: sliceRows(slices.ice),
    byApplication: sliceRows(slices.application),
    bySource: sliceRows(slices.source),
  };
}
