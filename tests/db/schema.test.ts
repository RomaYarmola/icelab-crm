import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPECTED_TABLES, EXPECTED_TRIGGERS } from "../../scripts/_db-expect";
import { createTestDb } from "./harness";

const EXPECTED_TABLE_NAMES = [
  "audit_log",
  "bank_accounts",
  "box_debts_legacy",
  "box_events",
  "box_types",
  "boxes",
  "cash_entries",
  "client_addresses",
  "client_applications",
  "client_contacts",
  "client_own_boxes",
  "client_prices",
  "client_statuses",
  "clients",
  "co2_adjustments",
  "co2_norms",
  "co2_receipts",
  "commission_rates",
  "default_prices",
  "error_log",
  "exports",
  "finance_months",
  "fx_rates",
  "ice_types",
  "ice_writeoffs",
  "intake_messages",
  "integration_logs",
  "ledger_categories",
  "ledger_entries",
  "locations",
  "login_failures",
  "np_cities",
  "np_sync_state",
  "np_warehouses",
  "order_boxes",
  "order_items",
  "order_price_changes",
  "order_sources",
  "order_status_history",
  "orders",
  "payment_matches",
  "payments",
  "product_prices",
  "products",
  "profiles",
  "regions",
  "reminders",
  "settings",
  "shipment_returns",
  "shipments",
  "site_leads",
  "telegram_link_codes",
  "telegram_sessions",
];

describe("структура бази", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  it("містить усі 17 таблиць блоку B1, невдалі входи з B2, журнал помилок з B3, області з B4 зміни цін замовлень з B5, готівку з B6, журнал експортів з B8, бокси з B9 Нову Пошту з B10 і приймання заявок з B11 і бокси клієнтів", async () => {
    const result = await ctx.db.execute(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    const names = (result.rows as { tablename: string }[]).map((r) => r.tablename);
    expect(names).toEqual(EXPECTED_TABLE_NAMES);
  });

  it("має увімкнену RLS на кожній таблиці", async () => {
    const result = await ctx.db.execute(
      sql`select c.relname as name, c.relrowsecurity as rls
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const rows = result.rows as { name: string; rls: boolean }[];
    expect(rows).toHaveLength(EXPECTED_TABLE_NAMES.length);
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

  it("числа для перевірки справжньої бази (db:smoke) відповідають міграціям", async () => {
    expect(EXPECTED_TABLES).toBe(EXPECTED_TABLE_NAMES.length);
    const result = await ctx.db.execute(
      sql`select count(*)::int as n from pg_trigger t
            join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not t.tgisinternal`,
    );
    expect(EXPECTED_TRIGGERS).toBe((result.rows as { n: number }[])[0]!.n);
  });

  it("повторне застосування міграцій нічого не ламає", async () => {
    await expect(migrate(ctx.db, { migrationsFolder: "./drizzle" })).resolves.not.toThrow();
  });
});
