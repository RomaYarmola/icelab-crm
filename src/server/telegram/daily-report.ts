import { and, eq, isNull, sql } from "drizzle-orm";
import { boxEvents, cashEntries, locations, npSyncState, orders, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { formatIsoDate } from "@/utils/isoDate";
import { getPublicUrl } from "../box-labels";
import { kyivDay } from "../intake/prompt";
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
export const DEFAULT_REPORT_TIME = "21:00";

export type LocationSummary = {
  locationId: string;
  name: string;
  orders: number;
  kg: number;
  shipped: number;
  cash: number;
  boxesIssued: number;
};

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Час зведення з налаштувань: `HH:MM`, інакше 21:00. */
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
    shipped: shippedBy.get(location.id)?.count ?? 0,
    cash: num(cashBy.get(location.id)?.total),
    boxesIssued: boxBy.get(location.id)?.count ?? 0,
  }));
}

const fmt = (value: number) => value.toLocaleString("uk-UA", { maximumFractionDigits: 2 });

/** Текст зведення для Telegram. */
export function formatDaySummary(day: string, rows: LocationSummary[], link?: string): string {
  const lines = [`Підсумок дня ${formatIsoDate(day)}`];
  const total = rows.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      kg: acc.kg + row.kg,
      cash: acc.cash + row.cash,
    }),
    { orders: 0, kg: 0, cash: 0 },
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
      );
    }
    if (rows.length > 1) {
      lines.push(
        "",
        `Разом: замовлень ${total.orders}, ${fmt(total.kg)} кг, готівкою ${fmt(total.cash)} грн.`,
      );
    }
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

  const [previous] = await db.select().from(npSyncState).where(eq(npSyncState.key, STATE_KEY));
  const claimed = await db
    .insert(npSyncState)
    .values({ key: STATE_KEY, phase: "idle", lastFinishedAt: now })
    .onConflictDoUpdate({
      target: npSyncState.key,
      set: { lastFinishedAt: now, updatedAt: now },
      setWhere: sql`(${npSyncState.lastFinishedAt} is null
        or (${npSyncState.lastFinishedAt} at time zone 'Europe/Kyiv')::date < ${day}::date)`,
    })
    .returning({ key: npSyncState.key });
  if (claimed.length === 0) return { sent: false, reason: "already" };

  try {
    const rows = await collectDaySummary(db, day);
    const base = await getPublicUrl(db);
    await send(ownerChatId, formatDaySummary(day, rows, `${base}/production`));
    return { sent: true, day };
  } catch {
    // Звільняємо спробу: наступний виклик розкладу спробує знову.
    await db
      .update(npSyncState)
      .set({ lastFinishedAt: previous?.lastFinishedAt ?? null })
      .where(eq(npSyncState.key, STATE_KEY));
    return { sent: false, reason: "failed" };
  }
}
