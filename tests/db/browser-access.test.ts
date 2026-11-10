import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";
import { pgErrorCode } from "./helpers";

// Рішення D19: браузер не ходить у таблиці напряму. Ролі Supabase `anon` (не увійшов) і
// `authenticated` (увійшов) не мають жодних прав на наші таблиці, послідовності й функції.
// Тестова база імітує права за замовчуванням Supabase (див. harness.ts), а міграція 0005 їх прибирає.

const INSUFFICIENT_PRIVILEGE = "42501";
const BROWSER_ROLES = ["anon", "authenticated"] as const;
const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

describe("доступ браузера до бази (ролі anon і authenticated)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    const result = await db.execute(query);
    return result.rows as T[];
  }

  /** Виконує дію від імені ролі браузера, а потім повертає роль власника. */
  async function asRole<T>(role: (typeof BROWSER_ROLES)[number], action: () => Promise<T>) {
    await db.execute(sql.raw(`set role ${role}`));
    try {
      return await action();
    } finally {
      await db.execute(sql`reset role`);
    }
  }

  const publicTables = () =>
    rows<{ oid: string; name: string; rls: boolean }>(sql`
      select c.oid::text as oid, c.relname as name, c.relrowsecurity as rls
        from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       order by c.relname`);

  it("перевірка самого тесту: сервісна роль Supabase має права за замовчуванням", async () => {
    // Якщо цього немає, тести нижче нічого б не доводили (прав і не було б).
    const [row] = await rows<{ ok: boolean }>(
      sql`select has_table_privilege('service_role', 'clients', 'SELECT') as ok`,
    );
    expect(row?.ok).toBe(true);
  });

  it("жодна таблиця в public не доступна ролям браузера, а RLS увімкнено на кожній", async () => {
    const tables = await publicTables();
    expect(tables.length).toBeGreaterThanOrEqual(18);

    const problems: string[] = [];
    for (const table of tables) {
      if (!table.rls) problems.push(`${table.name}: RLS вимкнено`);
      for (const role of BROWSER_ROLES) {
        for (const privilege of TABLE_PRIVILEGES) {
          const [row] = await rows<{ ok: boolean }>(
            sql`select has_table_privilege(${role}, ${table.oid}::oid, ${privilege}) as ok`,
          );
          if (row?.ok) problems.push(`${table.name}: ${role} має ${privilege}`);
        }
        const [column] = await rows<{ ok: boolean }>(
          sql`select has_any_column_privilege(${role}, ${table.oid}::oid, 'SELECT,INSERT,UPDATE,REFERENCES') as ok`,
        );
        if (column?.ok) problems.push(`${table.name}: ${role} має права на колонки`);
      }
    }
    // Якщо тест впав після додавання нової таблиці: у міграції для неї потрібен ENABLE ROW LEVEL
    // SECURITY (у Drizzle це `.enableRLS()`), а права для anon і authenticated видавати не можна.
    expect(problems).toEqual([]);
  });

  it("послідовності не доступні ролям браузера", async () => {
    const sequences = await rows<{ oid: string; name: string }>(sql`
      select c.oid::text as oid, c.relname as name
        from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'`);
    expect(sequences.length).toBeGreaterThan(0); // лічильник orders.number

    const problems: string[] = [];
    for (const sequence of sequences) {
      for (const role of BROWSER_ROLES) {
        const [row] = await rows<{ ok: boolean }>(
          sql`select has_sequence_privilege(${role}, ${sequence.oid}::oid, 'USAGE,SELECT,UPDATE') as ok`,
        );
        if (row?.ok) problems.push(`${sequence.name}: ${role}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("функції проєкту не виконуються ролями браузера (ні напряму, ні через PUBLIC)", async () => {
    const functions = await rows<{ oid: string; signature: string }>(sql`
      select p.oid::text as oid, p.oid::regprocedure::text as signature
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
    expect(functions.length).toBeGreaterThanOrEqual(5);

    const problems: string[] = [];
    for (const fn of functions) {
      for (const role of BROWSER_ROLES) {
        const [row] = await rows<{ ok: boolean }>(
          sql`select has_function_privilege(${role}, ${fn.oid}::oid, 'EXECUTE') as ok`,
        );
        if (row?.ok) problems.push(`${fn.signature}: ${role}`);
      }
    }
    // Якщо тест впав після додавання функції: у її міграції потрібен
    // `REVOKE ALL ON FUNCTION ... FROM PUBLIC` (Postgres за замовчуванням дозволяє виконання всім).
    expect(problems).toEqual([]);
  });

  it("на практиці: читання, запис і виклик функції від імені браузера відхиляються", async () => {
    for (const role of BROWSER_ROLES) {
      const attempts = [
        () => db.execute(sql`select * from clients`),
        () => db.execute(sql`select * from profiles`),
        () => db.execute(sql`select total from orders`),
        () => db.execute(sql`insert into locations (code, name) values ('x', 'x')`),
        () => db.execute(sql`update clients set name = 'x'`),
        () => db.execute(sql`delete from audit_log`),
        () => db.execute(sql`select current_actor()`),
      ];
      const codes = await asRole(role, async () => {
        const result: (string | undefined)[] = [];
        for (const attempt of attempts) result.push(await pgErrorCode(attempt()));
        return result;
      });
      expect(codes, role).toEqual(attempts.map(() => INSUFFICIENT_PRIVILEGE));
    }
  });

  it("сервер (роль-власник) і сервісна роль працюють як раніше", async () => {
    await db.execute(sql`select count(*) from clients`);
    await db.execute(sql`select current_actor()`);
    await db.execute(sql`set role service_role`);
    try {
      await db.execute(sql`select count(*) from clients`);
    } finally {
      await db.execute(sql`reset role`);
    }
  });
});
