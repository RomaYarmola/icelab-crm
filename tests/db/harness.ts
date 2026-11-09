import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

/**
 * Тестова база: справжній Postgres у пам'яті (PGlite), без Docker.
 * Застосовує ті самі міграції з папки `drizzle/`, що й реальна база.
 */
export async function createTestDb() {
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { client, db };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
