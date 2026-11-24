import { and, eq, isNull, sql } from "drizzle-orm";
import {
  boxEvents,
  cashEntries,
  locations,
  orderItems,
  orders,
  payments,
  products,
  settings,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { formatIsoDate } from "@/utils/isoDate";
import { getPublicUrl } from "../box-labels";
import { kyivDay } from "../intake/prompt";
import { claimDay } from "./day-claim";
import { getTelegramToken, sendMessage } from "./client";
import { getTelegramSettings } from "./settings";

/**
 * Вечірнє зведення власнику в Telegram (B11, ТЗ 8.3, D150): за день по кожній локації кількість
 * замовлень і кілограми, відправлено, отримано готівкою, видано боксів. Адреса розкладу
 * викликається часто (кожні півгодини), а надсилання відбувається один раз на київський день і не
 * раніше часу з налаштування `report.daily_time`.
 */

const TIME_KEY = "report.daily_time";
const STATE_KEY = "daily_report";
export const DEFAULT_REPORT_TIME = "18:00";

export type LocationSummary = {
  locationId: string;
  name: string;
  orders: number;
  kg: number;
  /** Самовивіз: замовлень і кг (20.11.2026). */
  pickupOrders: number;
  pickupKg: number;
  /** Доставка (Нова Пошта й старі способи): замовлень і кг. */
  deliveryOrders: number;
  deliveryKg: number;
  /** Продано боксів, шт, і інші товари (рідкий азот): назва, кількість, одиниця (D174). */
  boxesSold: number;
  otherProducts: { name: string; qty: number; unit: string }[];
  shipped: number;
  cash: number;
  boxesIssued: number;
};

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Час зведення з налаштувань: `HH:MM`, інакше 18:00. */
export async function getReportTime(db: AnyPgDatabase): Promise<string> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, TIME_KEY));
  const value = typeof row?.value === "string" ? row.value.trim() : "";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : DEFAULT_REPORT_TIME;
}

/** Година й хвилина за київським часом: `HH:MM`. */
export function kyivTime(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/** Підсумки дня по активних локаціях. */
export async function collectDaySummary(
  db: AnyPgDatabase,
  day: string,
): Promise<LocationSummary[]> {
  const locationRows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(locations.name);

  const orderRows = await db
    .select({
      locationId: orders.locationId,
      count: sql<number>`count(*)::int`,
      kg: sql<string>`coalesce(sum(${orders.kgSold}), 0)`,
      pickupCount: sql<number>`(count(*) filter (where ${orders.deliveryMethod} = 'pickup'))::int`,
      pickupKg: sql<string>`coalesce(sum(${orders.kgSold}) filter (where ${orders.deliveryMethod} = 'pickup'), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orderDate, day),
        isNull(orders.deletedAt),
        sql`${orders.status} not in ('draft', 'cancelled')`,
      ),
    )
    .groupBy(orders.locationId);

  const itemRows = await db
    .select({
      locationId: orders.locationId,
      kind: orderItems.kind,
      name: products.name,
      unit: orderItems.unit,
      qty: sql<string>`coalesce(sum(${orderItems.qty}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(
      and(
        eq(orders.orderDate, day),
        isNull(orders.deletedAt),
        sql`${orders.status} not in ('draft', 'cancelled')`,
        sql`${orderItems.kind} in ('box_sale', 'other')`,
        sql`(${orderItems.kind} = 'box_sale' or ${orderItems.productId} is not null)`,
      ),
    )
    .groupBy(orders.locationId, orderItems.kind, products.name, orderItems.unit);

  const shippedRows = await db
    .select({ locationId: orders.locationId, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        isNull(orders.deletedAt),
        sql`(${orders.shippedAt} at time zone 'Europe/Kyiv')::date = ${day}::date`,
      ),
    )
    .groupBy(orders.locationId);

  const cashRows = await db
    .select({
      locationId: cashEntries.locationId,
      total: sql<string>`coalesce(sum(${cashEntries.amount}), 0)`,
    })
    .from(cashEntries)
    .where(and(eq(cashEntries.receivedOn, day), isNull(cashEntries.reversedAt)))
    .groupBy(cashEntries.locationId);

  const boxRows = await db
    .select({ locationId: boxEvents.locationId, count: sql<number>`count(*)::int` })
    .from(boxEvents)
    .where(
      and(
        eq(boxEvents.event, "issued"),
        sql`(${boxEvents.occurredAt} at time zone 'Europe/Kyiv')::date = ${day}::date`,
      ),
    )
    .groupBy(boxEvents.locationId);

  const by = <T extends { locationId: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.locationId, row]));
  const orderBy = by(orderRows);
  const shippedBy = by(shippedRows);
  const cashBy = by(cashRows);
  const boxBy = by(boxRows);

  return locationRows.map((location) => ({
    locationId: location.id,
    name: location.name,
    orders: orderBy.get(location.id)?.count ?? 0,
    kg: num(orderBy.get(location.id)?.kg),
    pickupOrders: orderBy.get(location.id)?.pickupCount ?? 0,
    pickupKg: num(orderBy.get(location.id)?.pickupKg),
    deliveryOrders:
      (orderBy.get(location.id)?.count ?? 0) - (orderBy.get(location.id)?.pickupCount ?? 0),
    deliveryKg: num(orderBy.get(location.id)?.kg) - num(orderBy.get(location.id)?.pickupKg),
    boxesSold: itemRows
      .filter((item) => item.locationId === location.id && item.kind === "box_sale")
      .reduce((sum, item) => sum + num(item.qty), 0),
    otherProducts: itemRows
      .filter((item) => item.locationId === location.id && item.kind === "other" && item.name)
      .map((item) => ({ name: item.name!, qty: num(item.qty), unit: item.unit })),
    shipped: shippedBy.get(location.id)?.count ?? 0,
    cash: num(cashBy.get(location.id)?.total),
    boxesIssued: boxBy.get(location.id)?.count ?? 0,
  }));
}

/** «Бокси 3 шт; Рідкий азот 12 кг»: що продано окремо від льоду; порожній рядок, якщо нічого. */
function describeSold(boxesSold: number, others: LocationSummary["otherProducts"]): string {
  const parts = [
    ...(boxesSold > 0 ? [`бокси ${fmt(boxesSold)} шт`] : []),
    ...others.map((item) => `${item.name} ${fmt(item.qty)} ${item.unit}`),
  ];
  return parts.join("; ");
}

const fmt = (value: number) => value.toLocaleString("uk-UA", { maximumFractionDigits: 2 });

/** Інші товари всіх локацій разом (однакові за назвою й одиницею складаємо). */
function mergeProducts(rows: LocationSummary[]): LocationSummary["otherProducts"] {
  const merged = new Map<string, LocationSummary["otherProducts"][number]>();
  for (const row of rows) {
    for (const item of row.otherProducts) {
      const key = `${item.name}|${item.unit}`;
      const existing = merged.get(key);
      if (existing) existing.qty += item.qty;
      else merged.set(key, { ...item });
    }
  }
  return [...merged.values()];
}

/** Текст зведення для Telegram. */
export function formatDaySummary(
  day: string,
  rows: LocationSummary[],
  link?: string,
  extra: { unmatchedPayments?: number } = {},
): string {
  const lines = [`Підсумок дня ${formatIsoDate(day)}`];
  const total = rows.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      kg: acc.kg + row.kg,
      cash: acc.cash + row.cash,
      boxesSold: acc.boxesSold + row.boxesSold,
      pickupOrders: acc.pickupOrders + row.pickupOrders,
      pickupKg: acc.pickupKg + row.pickupKg,
      deliveryOrders: acc.deliveryOrders + row.deliveryOrders,
      deliveryKg: acc.deliveryKg + row.deliveryKg,
    }),
    {
      orders: 0,
      kg: 0,
      cash: 0,
      boxesSold: 0,
      pickupOrders: 0,
      pickupKg: 0,
      deliveryOrders: 0,
      deliveryKg: 0,
    },
  );
  if (
    total.orders === 0 &&
    total.cash === 0 &&
    rows.every((r) => r.shipped + r.boxesIssued === 0)
  ) {
    lines.push("", "Сьогодні замовлень, оплат і відправлень не було.");
  } else {
    for (const row of rows) {
      lines.push(
        "",
        `${row.name}: замовлень ${row.orders}, ${fmt(row.kg)} кг; відправлено ${row.shipped}; готівкою отримано ${fmt(row.cash)} грн; боксів видано ${row.boxesIssued}.`,
        `Самовивіз: ${row.pickupOrders}, ${fmt(row.pickupKg)} кг; доставка: ${row.deliveryOrders}, ${fmt(row.deliveryKg)} кг.`,
      );
      const sold = describeSold(row.boxesSold, row.otherProducts);
      if (sold) lines.push(`Продано окремо: ${sold}.`);
    }
    if (rows.length > 1) {
      lines.push(
        "",
        `Разом: замовлень ${total.orders}, ${fmt(total.kg)} кг, готівкою ${fmt(total.cash)} грн.`,
        `Самовивіз разом: ${total.pickupOrders}, ${fmt(total.pickupKg)} кг; доставка разом: ${total.deliveryOrders}, ${fmt(total.deliveryKg)} кг.`,
      );
      const soldTotal = describeSold(total.boxesSold, mergeProducts(rows));
      if (soldTotal) lines.push(`Продано окремо разом: ${soldTotal}.`);
    }
  }
  if (extra.unmatchedPayments && extra.unmatchedPayments > 0) {
    lines.push(
      "",
      `Нерозпізнаних платежів: ${extra.unmatchedPayments} (екран «Оплати», вкладка «Нерозпізнані»).`,
    );
  }
  if (link) lines.push("", link);
  return lines.join("\n");
}

export type DailyReportResult =
  | { sent: true; day: string }
  | { sent: false; reason: "not_yet" | "already" | "no_chat" | "no_token" | "failed" };

export type DailyReportDeps = {
  now?: Date;
  send?: (chatId: number, text: string) => Promise<unknown>;
};

/**
 * Надсилає зведення, якщо настав час і за цей київський день воно ще не надсилалось. Спробу
 * «займаємо» до відправлення (умовним оновленням), тож два одночасні виклики не пошлють двічі;
 * якщо відправлення не вдалось, спробу звільняємо і наступний виклик повторить.
 */
export async function runDailyReport(
  db: AnyPgDatabase,
  deps: DailyReportDeps = {},
): Promise<DailyReportResult> {
  const now = deps.now ?? new Date();
  const day = kyivDay(now);
  if (kyivTime(now) < (await getReportTime(db))) return { sent: false, reason: "not_yet" };

  const { ownerChatId } = await getTelegramSettings(db);
  if (!ownerChatId) return { sent: false, reason: "no_chat" };
  const send =
    deps.send ??
    (getTelegramToken()
      ? (chatId: number, text: string) => sendMessage(db, { chatId, text })
      : null);
  if (!send) return { sent: false, reason: "no_token" };

  const claim = await claimDay(db, STATE_KEY, now, day);
  if (!claim) return { sent: false, reason: "already" };

  try {
    const rows = await collectDaySummary(db, day);
    const base = await getPublicUrl(db);
    const [unmatched] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(payments)
      .where(eq(payments.matchStatus, "unmatched"));
    await send(
      ownerChatId,
      formatDaySummary(day, rows, `${base}/production`, { unmatchedPayments: unmatched?.n ?? 0 }),
    );
    return { sent: true, day };
  } catch {
    // Звільняємо спробу: наступний виклик розкладу спробує знову.
    await claim.release();
    return { sent: false, reason: "failed" };
  }
}
