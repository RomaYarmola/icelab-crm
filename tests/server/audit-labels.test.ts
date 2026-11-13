import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rowsOf } from "@/db/rows";
import { AUDIT_SECTIONS, AUDIT_TABLES, tablesOfSection } from "@/server/audit-labels";
import { createTestDb } from "../db/harness";

describe("словник журналу змін (D90)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  /** Таблиці, на яких у базі висить тригер журналу `<таблиця>_audit`. */
  const auditedTables = async () =>
    rowsOf<{ name: string }>(
      await ctx.db.execute(
        sql`select c.relname as name
              from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where t.tgname like '%\_audit' and not t.tgisinternal
             order by 1`,
      ),
    ).map((row) => row.name);

  it("для кожної таблиці, що пише журнал, є опис, і навпаки", async () => {
    const audited = await auditedTables();
    expect(audited.length).toBeGreaterThanOrEqual(11);
    expect(Object.keys(AUDIT_TABLES).sort()).toEqual(audited.sort());
  });

  it("кожна колонка кожної таблиці має підпис: нова таблиця чи поле без підпису не пройде CI", async () => {
    const missing: string[] = [];
    for (const table of await auditedTables()) {
      const columns = rowsOf<{ name: string }>(
        await ctx.db.execute(
          sql`select column_name as name from information_schema.columns
               where table_schema = 'public' and table_name = ${table}`,
        ),
      ).map((row) => row.name);
      for (const column of columns) {
        if (!AUDIT_TABLES[table]?.fields[column]) missing.push(`${table}.${column}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("підписи не порожні, переліки мають значення, кожен розділ має таблиці", () => {
    for (const [name, table] of Object.entries(AUDIT_TABLES)) {
      expect(table.label.length, name).toBeGreaterThan(0);
      expect(table.noun.length, name).toBeGreaterThan(0);
      expect(AUDIT_SECTIONS[table.section], name).toBeTruthy();
      for (const [column, field] of Object.entries(table.fields)) {
        expect(field.label.trim().length, `${name}.${column}`).toBeGreaterThan(0);
        if (field.kind === "enum") {
          expect(Object.keys(field.values).length, `${name}.${column}`).toBeGreaterThan(0);
        }
      }
    }
    for (const section of Object.keys(AUDIT_SECTIONS) as (keyof typeof AUDIT_SECTIONS)[]) {
      expect(tablesOfSection(section).length, section).toBeGreaterThan(0);
    }
  });

  it("службові поля (ідентифікатори, автор, час запису) сховані, видимі мають людську назву", () => {
    for (const [name, table] of Object.entries(AUDIT_TABLES)) {
      for (const column of ["id", "created_at", "updated_at", "created_by"]) {
        const field = table.fields[column];
        if (field) expect(field.kind, `${name}.${column}`).toBe("hidden");
      }
      for (const [column, field] of Object.entries(table.fields)) {
        if (field.kind !== "hidden") expect(field.label, `${name}.${column}`).not.toMatch(/_/);
      }
    }
  });
});
