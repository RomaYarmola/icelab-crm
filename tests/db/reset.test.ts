import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/reset";
import { seedReferenceData } from "@/db/seed";
import { createTestDb, type TestDb } from "./harness";

describe("resetDatabase", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const rows = async (query: ReturnType<typeof sql>) => (await db.execute(query)).rows;

  it("прибирає таблиці, типи, функції проєкту й журнал міграцій, але не розширення", async () => {
    await seedReferenceData(db);

    await resetDatabase(db);

    expect(await rows(sql`select 1 from pg_tables where schemaname = 'public'`)).toEqual([]);
    expect(
      await rows(
        sql`select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where n.nspname = 'public' and t.typtype = 'e'`,
      ),
    ).toEqual([]);
    expect(
      await rows(
        sql`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('current_actor', 'audit_row_change')`,
      ),
    ).toEqual([]);
    expect(await rows(sql`select 1 from pg_namespace where nspname = 'drizzle'`)).toEqual([]);
    expect(await rows(sql`select 1 from pg_extension where extname = 'pg_trgm'`)).toHaveLength(1);
  });

  it("після скидання міграції й seed застосовуються заново", async () => {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const added = await seedReferenceData(db);
    expect(added.locations).toBe(2);
  });
});
