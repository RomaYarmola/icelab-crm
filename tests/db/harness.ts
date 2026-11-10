import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

/**
 * Те, що в Supabase є до наших міграцій: ролі `anon`, `authenticated`, `service_role`,
 * схема `auth` з таблицею користувачів (спрощена: лише потрібні нам колонки) і права за
 * замовчуванням, які Supabase видає на нові об'єкти в `public`.
 * Міграція `0005` має ці права прибрати: тест у `browser-access.test.ts` це перевіряє.
 */
const SUPABASE_BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key, email text);

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

/**
 * Тестова база: справжній Postgres у пам'яті (PGlite), без Docker.
 * Застосовує ті самі міграції з папки `drizzle/`, що й реальна база.
 */
export async function createTestDb() {
  const client = new PGlite({ extensions: { pg_trgm } });
  await client.exec(SUPABASE_BOOTSTRAP);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { client, db };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
