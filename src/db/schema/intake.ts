import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { pk, restrict, timestamps } from "./_common";
import { intakeChannel, intakeParseStatus } from "./enums";
import { orders } from "./orders";
import { locations, profiles } from "./reference";

/**
 * Приймання заявок (B11, ТЗ 4.7). Повідомлення групи Telegram, заявки з сайту й одноразові коди
 * прив'язки Telegram до профілю. Журналу змін на цих таблицях немає: це вхідні дані, а не робочі
 * записи (зміни самих замовлень пише журнал замовлень).
 */

/** Повідомлення, з яких виходять чернетки замовлень. Унікальне за чатом і номером повідомлення. */
export const intakeMessages = pgTable(
  "intake_messages",
  {
    id: pk(),
    channel: intakeChannel("channel").notNull().default("telegram"),
    telegramChatId: bigint("telegram_chat_id", { mode: "number" }),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    telegramThreadId: bigint("telegram_thread_id", { mode: "number" }),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }),
    /** Локація за топіком групи. */
    locationId: uuid("location_id").references(() => locations.id, restrict),
    text: text("text").notNull().default(""),
    voiceFileId: text("voice_file_id"),
    transcript: text("transcript"),
    parseStatus: intakeParseStatus("parse_status").notNull().default("new"),
    /** Чому повідомлення пропущено (не менеджер, не з топіка…). */
    skipReason: text("skip_reason"),
    parseResult: jsonb("parse_result"),
    parseError: text("parse_error"),
    orderId: uuid("order_id").references(() => orders.id, restrict),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("intake_messages_chat_message_key")
      .on(t.telegramChatId, t.telegramMessageId)
      .where(sql`${t.telegramChatId} is not null and ${t.telegramMessageId} is not null`),
    index("intake_messages_status_created_idx").on(t.parseStatus, t.createdAt),
    index("intake_messages_order_id_idx").on(t.orderId),
    index("intake_messages_location_id_idx").on(t.locationId),
  ],
).enableRLS();

/** Заявки з сайту (ТЗ 8.1). `dedupe_key` = хеш телефону й 10-хвилинного вікна. */
export const siteLeads = pgTable(
  "site_leads",
  {
    id: pk(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull(),
    orderId: uuid("order_id").references(() => orders.id, restrict),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    uniqueIndex("site_leads_dedupe_key_key").on(t.dedupeKey),
    index("site_leads_order_id_idx").on(t.orderId),
    index("site_leads_received_at_idx").on(t.receivedAt),
  ],
).enableRLS();

/** Одноразові коди, якими користувач пов'язує свій Telegram з профілем (`/start КОД`, D136). */
export const telegramLinkCodes = pgTable(
  "telegram_link_codes",
  {
    code: text("code").primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("telegram_link_codes_profile_id_idx").on(t.profileId)],
).enableRLS();
