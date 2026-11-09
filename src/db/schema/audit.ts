import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pk, restrict } from "./_common";
import { auditAction } from "./enums";
import { profiles } from "./reference";

/**
 * Журнал змін (розділ 4.9 ТЗ). Рядки пише тригер `audit_row_change`.
 * `diff`: для зміни `{ "поле": { "old": ..., "new": ... } }` лише для змінених полів,
 * для створення тільки `new`, для видалення тільки `old`.
 * Порожній `actor_id` означає системну зміну.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    tableName: text("table_name").notNull(),
    /** Значення первинного ключа як текст (у `settings` ключ текстовий). */
    rowId: text("row_id").notNull(),
    action: auditAction("action").notNull(),
    actorId: uuid("actor_id").references(() => profiles.id, restrict),
    // clock_timestamp(), а не now(): усередині однієї транзакції now() однаковий, і порядок
    // записів журналу був би невизначеним.
    at: timestamp("at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    diff: jsonb("diff").notNull(),
  },
  (t) => [
    index("audit_log_table_row_idx").on(t.tableName, t.rowId),
    index("audit_log_at_idx").on(t.at),
    index("audit_log_actor_id_idx").on(t.actorId),
  ],
).enableRLS();
