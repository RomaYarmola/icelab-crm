import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { getEnv } from "@/env";

type Sql = ReturnType<typeof postgres>;

// Зберігаємо з'єднання в globalThis, щоб гаряче перезавантаження в dev не плодило нові.
// Разом із клієнтом пам'ятаємо рядок підключення, з яким його створено.
const globalForDb = globalThis as unknown as { __icelabSql?: { url: string; sql: Sql } };

/**
 * Одне з'єднання на екземпляр функції: пулер Supabase і serverless не люблять великих пулів.
 * `prepare: false` сумісне і з Session pooler, і з Transaction pooler.
 *
 * Якщо `DATABASE_URL` змінився (у dev після правки .env.local), старий клієнт закривається
 * і створюється новий, тож перезапуск сервера не потрібен.
 */
export function getSql(): Sql {
  const url = getEnv().DATABASE_URL;
  const current = globalForDb.__icelabSql;
  if (current?.url === url) return current.sql;

  void current?.sql.end({ timeout: 5 });
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    connect_timeout: 10,
    idle_timeout: 20,
  });
  globalForDb.__icelabSql = { url, sql };
  return sql;
}

/** Закриває з'єднання (для тестів, скриптів і коректного завершення). */
export async function closeSql(): Promise<void> {
  const current = globalForDb.__icelabSql;
  globalForDb.__icelabSql = undefined;
  await current?.sql.end({ timeout: 5 });
}

export function getDb() {
  return drizzle({ client: getSql(), schema });
}
