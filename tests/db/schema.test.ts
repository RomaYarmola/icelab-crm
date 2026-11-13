import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./harness";

const EXPECTED_TABLES = [
  "audit_log",
  "box_types",
  "cash_entries",
  "client_addresses",
  "client_applications",
  "client_contacts",
  "client_prices",
  "client_statuses",
  "clients",
  "default_prices",
  "error_log",
  "ice_types",
  "locations",
  "login_failures",
  "order_items",
  "order_price_changes",
  "order_sources",
  "order_status_history",
  "orders",
  "profiles",
  "regions",
  "settings",
];

describe("структура бази", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  it("містить усі 17 таблиць блоку B1, невдалі входи з B2, журнал помилок з B3, області з B4 зміни цін замовлень з B5 і готівку з B6", async () => {
    const result = await ctx.db.execute(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    const names = (result.rows as { tablename: string }[]).map((r) => r.tablename);
    expect(names).toEqual(EXPECTED_TABLES);
  });

  it("має увімкнену RLS на кожній таблиці", async () => {
    const result = await ctx.db.execute(
      sql`select c.relname as name, c.relrowsecurity as rls
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const rows = result.rows as { name: string; rls: boolean }[];
    expect(rows).toHaveLength(EXPECTED_TABLES.length);
    expect(rows.filter((r) => !r.rls).map((r) => r.name)).toEqual([]);
  });

  it("має індекс на кожен зовнішній ключ", async () => {
    const result = await ctx.db.execute(
      sql`select c.conrelid::regclass::text as tbl, a.attname as col
            from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.connamespace = 'public'::regnamespace
             and not exists (
               select 1 from pg_index i
                where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
             )`,
    );
    expect(result.rows).toEqual([]);
  });

  it("повторне застосування міграцій нічого не ламає", async () => {
    await expect(migrate(ctx.db, { migrationsFolder: "./drizzle" })).resolves.not.toThrow();
  });
});
