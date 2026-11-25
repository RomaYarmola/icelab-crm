import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { pk, restrict } from "./_common";
import { boxes } from "./boxes";
import { clients } from "./clients";
import { reminderKind } from "./enums";
import { profiles } from "./reference";

/**
 * Нагадування (B14, ТЗ 4.8, 7.7, D209): кому, про що і коли. Унікальний `dedupe_key` не дає створити
 * двічі. Це службові записи про вже наявні дані, тому журналу змін на них немає.
 */
export const reminders = pgTable(
  "reminders",
  {
    id: pk(),
    kind: reminderKind("kind").notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id")
      .notNull()
      .references(() => profiles.id, restrict),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    /** Коли надіслано в Telegram; `null`, якщо не надсилали (людина не підключила бота). */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** «Відкласти»: людина прибрала нагадування зі свого списку. */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reminders_dedupe_key_key").on(t.dedupeKey),
    index("reminders_assignee_due_idx").on(t.assigneeId, t.dueAt),
    index("reminders_client_id_idx").on(t.clientId),
    index("reminders_box_id_idx").on(t.boxId),
  ],
).enableRLS();
