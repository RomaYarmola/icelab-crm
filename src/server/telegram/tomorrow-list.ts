import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { clients, locations, orders, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import { formatIsoDate } from "@/utils/isoDate";
import { kyivDay } from "../intake/prompt";
import { getTelegramToken, sendMessage } from "./client";
import { claimDay } from "./day-claim";
import { getTelegramSettings } from "./settings";

/**
 * Список замовлень на завтра для Києва (B11, D160): щодня о 18:00 за київським часом у топік «Київ»
 * групи; Київ обговорює його в групі, раніше таблицю надсилали вручну. Адреса розкладу викликається
 * часто, а надсилання відбувається один раз на день і не раніше часу `report.tomorrow_list_time`.
 */

const TIME_KEY = "report.tomorrow_list_time";
const STATE_KEY = "tomorrow_list";
export const DEFAULT_TOMORROW_LIST_TIME = "18:00";

export async function getTomorrowListTime(db: AnyPgDatabase): Promise<string> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, TIME_KEY));
  const value = typeof row?.value === "string" ? row.value.trim() : "";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : DEFAULT_TOMORROW_LIST_TIME;
}

const kyivTime = (now: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);

/** Наступний день за київським календарем. */
export function nextKyivDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export type TomorrowRow = {
  clientName: string;
  kg: number;
  timeWindow: string | null;
  deliveryMethod: keyof typeof DELIVERY_METHOD_LABELS;
  deliveryText: string | null;
};

export type TomorrowData = { rows: TomorrowRow[]; drafts: number };

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Підтверджені й далі замовлення Києва на день (за часом), плюс кількість чернеток. */
export async function collectTomorrow(db: AnyPgDatabase, day: string): Promise<TomorrowData> {
  const [kyiv] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.code, "kyiv"));
  if (!kyiv) return { rows: [], drafts: 0 };
  const base = and(
    eq(orders.locationId, kyiv.id),
    eq(orders.orderDate, day),
    isNull(orders.deletedAt),
  );
  const rows = await db
    .select({
      clientName: clients.name,
      kg: orders.kgSold,
      timeWindow: orders.timeWindow,
      deliveryMethod: orders.deliveryMethod,
      deliveryText: orders.deliveryText,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(and(base, sql`${orders.status} not in ('draft', 'cancelled')`))
    .orderBy(sql`${orders.timeWindow} asc nulls last`, asc(clients.name));
  const [draftRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(base, eq(orders.status, "draft")));
  return { rows: rows.map((row) => ({ ...row, kg: num(row.kg) })), drafts: draftRow?.n ?? 0 };
}

const fmt = (value: number) => value.toLocaleString("uk-UA", { maximumFractionDigits: 2 });

/** Текст списку: клієнт, кг, час, а для доставки ще адреса чи район. */
export function formatTomorrowList(day: string, data: TomorrowData): string {
  const lines = [`Замовлення на завтра, ${formatIsoDate(day)}, Київ`];
  if (data.rows.length === 0) {
    lines.push("", "Підтверджених замовлень поки немає.");
  } else {
    lines.push("");
    data.rows.forEach((row, index) => {
      const where =
        row.deliveryMethod === "pickup"
          ? "самовивіз"
          : [DELIVERY_METHOD_LABELS[row.deliveryMethod], row.deliveryText]
              .filter(Boolean)
              .join(", ");
      const parts = [row.clientName, `${fmt(row.kg)} кг`, row.timeWindow, where].filter(Boolean);
      lines.push(`${index + 1}. ${parts.join(" · ")}`);
    });
    const total = data.rows.reduce((sum, row) => sum + row.kg, 0);
    lines.push("", `Разом: ${data.rows.length} замовл., ${fmt(total)} кг.`);
  }
  if (data.drafts > 0) lines.push(`Чекають підтвердження: ${data.drafts}.`);
  return lines.join("\n");
}

export type TomorrowListResult =
  | { sent: true; day: string }
  | { sent: false; reason: "not_yet" | "already" | "no_topic" | "no_token" | "failed" };

export type TomorrowListDeps = {
  now?: Date;
  send?: (chatId: number, threadId: number, text: string) => Promise<unknown>;
};

export async function runTomorrowList(
  db: AnyPgDatabase,
  deps: TomorrowListDeps = {},
): Promise<TomorrowListResult> {
  const now = deps.now ?? new Date();
  if (kyivTime(now) < (await getTomorrowListTime(db))) return { sent: false, reason: "not_yet" };

  const { groupChatId, topicKyiv } = await getTelegramSettings(db);
  if (!groupChatId || !topicKyiv) return { sent: false, reason: "no_topic" };
  const send =
    deps.send ??
    (getTelegramToken()
      ? (chatId: number, threadId: number, text: string) =>
          sendMessage(db, { chatId, threadId, text })
      : null);
  if (!send) return { sent: false, reason: "no_token" };

  const today = kyivDay(now);
  const claim = await claimDay(db, STATE_KEY, now, today);
  if (!claim) return { sent: false, reason: "already" };

  try {
    const day = nextKyivDay(today);
    await send(groupChatId, topicKyiv, formatTomorrowList(day, await collectTomorrow(db, day)));
    return { sent: true, day };
  } catch {
    await claim.release();
    return { sent: false, reason: "failed" };
  }
}
