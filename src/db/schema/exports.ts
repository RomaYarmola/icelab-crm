import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pk, restrict } from "./_common";
import { exportKind } from "./enums";
import { profiles } from "./reference";

/**
 * Журнал експортів в Excel (ТЗ 4.9, D95): хто, що, з якими фільтрами, скільки рядків і коли
 * вивантажив. Самі файли не зберігаємо (`file_url` лишаємо за ТЗ на майбутнє). Запис додають і не
 * змінюють: це перевіряє тригер бази. Видно власнику й бухгалтеру в журналі змін.
 */
export const dataExports = pgTable(
  "exports",
  {
    id: pk(),
    kind: exportKind("kind").notNull(),
    /** Фільтри, з якими вивантажили (стан екрана). */
    params: jsonb("params")
      .notNull()
      .default(sql`'{}'::jsonb`),
    rowCount: integer("row_count").notNull(),
    fileName: text("file_name").notNull(),
    fileUrl: text("file_url"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, restrict),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("exports_created_at_idx").on(t.createdAt),
    index("exports_created_by_idx").on(t.createdBy),
    check("exports_row_count_ok", sql`${t.rowCount} >= 0`),
  ],
).enableRLS();
