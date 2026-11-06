import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/env";

type Sql = ReturnType<typeof postgres>;

// Зберігаємо з'єднання в globalThis, щоб гаряче перезавантаження в dev не плодило нові.
const globalForDb = globalThis as unknown as { __icelabSql?: Sql };

/**
 * Одне з'єднання на екземпляр функції: пулер Supabase і serverless не люблять великих пулів.
 * `prepare: false` сумісне і з Session pooler, і з Transaction pooler.
 */
export function getSql(): Sql {
  globalForDb.__icelabSql ??= postgres(getEnv().DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: "require",
    connect_timeout: 10,
    idle_timeout: 20,
  });
  return globalForDb.__icelabSql;
}

export function getDb() {
  return drizzle({ client: getSql() });
}
