import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { pk } from "./_common";

/**
 * Журнал помилок сервера. Потрібен, бо логи функцій Vercel Hobby живуть лише годину (D28).
 * Однакові помилки (той самий джерело, адреса й текст) протягом години не множимо, а рахуємо в
 * `count`, тож потік помилок не роздуває базу. Зберігаємо тільки те, що потрібно для розбору:
 * текст помилки, початок стеку, адресу без параметрів і метод. Особистих даних (користувач,
 * e-mail, IP, тіло запиту) сюди не пишемо. Рядки старші за 30 днів видаляються при записі.
 */
export const errorLog = pgTable(
  "error_log",
  {
    id: pk(),
    /** `render`, `route`, `action`, `proxy` (за Next.js) або `form_action` (помилка дії форми). */
    source: text("source").notNull(),
    message: text("message").notNull(),
    /** Ідентифікатор помилки, який Next.js показує на екрані помилки (за ним шукаємо запис). */
    digest: text("digest"),
    /** Початок стеку (обрізаний). */
    stack: text("stack"),
    /** Адреса без параметрів запиту. */
    path: text("path"),
    method: text("method"),
    /** Скільки разів помилка повторилась з `first_seen_at` до `last_seen_at`. */
    count: integer("count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("error_log_last_seen_idx").on(t.lastSeenAt),
    index("error_log_fingerprint_idx").on(t.source, t.path, t.lastSeenAt),
  ],
).enableRLS();
