import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { pk } from "./_common";

/**
 * Невдалі спроби входу за паролем (рішення D20): за ними застосунок обмежує підбір пароля
 * за e-mail і за адресою клієнта. Обмеження в самому застосунку потрібне, бо Supabase для
 * входу через наш сервер бачить лише адресу сервера.
 *
 * Зберігаємо тільки невдалі спроби: після успішного входу рядки цього e-mail видаляються,
 * а старіші за добу видаляються при кожному записі. Адреса клієнта (`ip`) особисті дані,
 * тому живе тут недовго.
 */
export const loginFailures = pgTable(
  "login_failures",
  {
    id: pk(),
    /** E-mail у нормалізованому вигляді (нижній регістр). Може бути неіснуючим акаунтом. */
    email: text("email").notNull(),
    /** Адреса клієнта з `x-forwarded-for`. Порожня, якщо її не вдалося визначити. */
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_failures_email_created_idx").on(t.email, t.createdAt),
    index("login_failures_ip_created_idx").on(t.ip, t.createdAt),
    index("login_failures_created_idx").on(t.createdAt),
  ],
).enableRLS();
