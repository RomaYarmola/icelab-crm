import "./_load-env";
import { eq, sql } from "drizzle-orm";
import { closeSql, getDb, getSql } from "@/db/client";
import {
  auditLog,
  clients,
  locations,
  orderItems,
  orders,
  orderStatusHistory,
  profiles,
} from "@/db/schema";
import { getEnv } from "@/env";

// Перевіряє структуру і тригери на справжній базі (dev або staging).
// Усі записи виконуються в транзакції, яку наприкінці скасовують, тож у базі нічого не лишається.

// 17 таблиць B1, login_failures (B2), error_log (B3), regions (B4), order_price_changes (B5) і
// cash_entries (B6)
const EXPECTED_TABLES = 22;
// 15 (updated_at) + 6 (created_by) + 1 (сума) + 1 (історія статусів) + 9 (журнал змін: з B4 ще
// прайс, контакти й адреси клієнтів) + 1 (зміни цін, B5) + 3 (готівка, B6: час зміни, журнал,
// захист від правки й видалення)
const EXPECTED_TRIGGERS = 36;
const TEST_CODE = "ЯЯ9999"; // «ЯЯ9999» кирилицею

class Rollback extends Error {}

type Check = { name: string; ok: boolean; details: string };

async function main() {
  const { APP_ENV } = getEnv();
  console.log(`Перевірка бази, середовище: ${APP_ENV}\n`);

  const checks: Check[] = [];
  const check = (name: string, ok: boolean, details = "") => checks.push({ name, ok, details });

  // 1. Структура (лише читання).
  const raw = getSql();
  const tables = await raw`
    select c.relname as name, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`;
  check(
    `${EXPECTED_TABLES} таблиць у схемі public`,
    tables.length === EXPECTED_TABLES,
    `знайдено ${tables.length}`,
  );
  const noRls = tables.filter((t) => !t.rls).map((t) => t.name);
  check("RLS увімкнено на кожній таблиці", noRls.length === 0, noRls.join(", "));

  // Рішення D19: браузер не ходить у таблиці напряму. Ролі Supabase `anon` (не увійшов) і
  // `authenticated` (увійшов) не мають жодних прав на наші таблиці, послідовності й функції.
  const browserRoles = await raw`
    select rolname from pg_roles where rolname in ('anon', 'authenticated')`;
  if (browserRoles.length === 0) {
    check("ролі anon і authenticated існують (Supabase)", false, "не знайдено: це не Supabase?");
  } else {
    const exposed = await raw`
      select c.relname || ' (' || r.rolname || ')' as item
        from pg_class c cross join pg_roles r
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
         and r.rolname in ('anon', 'authenticated')
         and has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      union all
      select c.relname || ' (' || r.rolname || ', послідовність)'
        from pg_class c cross join pg_roles r
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
         and r.rolname in ('anon', 'authenticated')
         and has_sequence_privilege(r.rolname, c.oid, 'USAGE,SELECT,UPDATE')
      union all
      select p.oid::regprocedure::text || ' (' || r.rolname || ', функція)'
        from pg_proc p cross join pg_roles r
       where p.pronamespace = 'public'::regnamespace
         and r.rolname in ('anon', 'authenticated')
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`;
    check(
      "ролі anon і authenticated не мають прав на таблиці, послідовності й функції",
      exposed.length === 0,
      exposed.map((row) => row.item).join(", "),
    );
  }

  const [triggers] = await raw`
    select count(*)::int as n from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal`;
  check(
    `${EXPECTED_TRIGGERS} тригерів`,
    triggers?.n === EXPECTED_TRIGGERS,
    `знайдено ${triggers?.n}`,
  );

  const counts = await raw`
    select (select count(*)::int from locations) as locations,
           (select count(*)::int from ice_types) as ice_types,
           (select count(*)::int from settings) as settings`;
  check(
    "довідники заповнені (локації, типи льоду, налаштування)",
    (counts[0]?.locations ?? 0) > 0 &&
      (counts[0]?.ice_types ?? 0) > 0 &&
      (counts[0]?.settings ?? 0) > 0,
    JSON.stringify(counts[0]),
  );

  // 2. Тригери й обмеження в транзакції, яку скасовуємо.
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      // Усередині транзакції користуємось лише tx: з'єднання з базою одне.
      const [location] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.code, "kyiv"));
      if (!location) throw new Error("Немає локації kyiv: спершу запустіть npm run db:seed.");

      // Профіль 1 до 1 з акаунтом Supabase: спершу акаунт (у транзакції, яку скасуємо).
      const actorId = crypto.randomUUID();
      await tx.execute(sql`insert into auth.users (id) values (${actorId})`);
      const [actor] = await tx
        .insert(profiles)
        .values({ id: actorId, fullName: "Перевірка", role: "manager" })
        .returning();

      let orphanRejected = false;
      try {
        await tx.transaction(async (inner) => {
          await inner
            .insert(profiles)
            .values({ id: crypto.randomUUID(), fullName: "Без акаунта", role: "manager" });
        });
      } catch {
        orphanRejected = true;
      }
      check("профіль без акаунта Supabase відхиляється", orphanRejected);
      await tx.execute(
        sql`select set_config('app.actor_id', ${actor!.id}, true), set_config('app.change_note', 'перевірка', true)`,
      );

      const [client] = await tx
        .insert(clients)
        .values({ code: TEST_CODE, name: "Перевірочний клієнт" })
        .returning();
      check("автор запису підставляється з app.actor_id", client!.createdBy === actor!.id);

      let latinRejected = false;
      try {
        await tx.transaction(async (inner) => {
          await inner.insert(clients).values({ code: "AA9998", name: "Латиниця" });
        });
      } catch {
        latinRejected = true;
      }
      check("латинський код клієнта відхиляється", latinRejected);

      const [order] = await tx
        .insert(orders)
        .values({ clientId: client!.id, locationId: location.id, orderDate: "2026-11-09" })
        .returning();
      await tx.insert(orderItems).values([
        { orderId: order!.id, kind: "ice", title: "Лід", qty: "2", price: "10.50" },
        { orderId: order!.id, kind: "delivery", title: "Доставка", qty: "1.333", price: "3.00" },
      ]);
      const [withTotal] = await tx
        .select({ total: orders.total })
        .from(orders)
        .where(eq(orders.id, order!.id));
      // 2 × 10.50 = 21.00, 1.333 × 3.00 = 3.999 → 4.00
      check(
        "сума замовлення перераховується (21.00 + 4.00)",
        withTotal?.total === "25.00",
        `total = ${withTotal?.total}`,
      );

      await tx
        .update(orders)
        .set({ status: "confirmed", pricePerKgSnapshot: "75" })
        .where(eq(orders.id, order!.id));
      const history = await tx
        .select()
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, order!.id))
        .orderBy(orderStatusHistory.changedAt);
      check(
        "історія статусів: створення і зміна з автором та приміткою",
        history.length === 2 &&
          history[1]?.fromStatus === "draft" &&
          history[1]?.toStatus === "confirmed" &&
          history[1]?.changedBy === actor!.id &&
          history[1]?.note === "перевірка",
        `записів: ${history.length}`,
      );

      await tx.update(clients).set({ name: "Нова назва" }).where(eq(clients.id, client!.id));
      const audit = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.rowId, client!.id))
        .orderBy(auditLog.at);
      // Ключі jsonb Postgres зберігає у власному порядку, тому порівнюємо за значеннями.
      const diff = (audit[1]?.diff ?? {}) as Record<string, { old?: unknown; new?: unknown }>;
      check(
        "журнал змін: створення і зміна лише поля name з автором",
        audit.length === 2 &&
          audit[1]?.actorId === actor!.id &&
          Object.keys(diff).join() === "name" &&
          diff.name?.old === "Перевірочний клієнт" &&
          diff.name?.new === "Нова назва",
        `записів: ${audit.length}, поля: ${Object.keys(diff).join(", ")}`,
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  const [left] = await raw`select count(*)::int as n from clients where code = ${TEST_CODE}`;
  check("після перевірки тестових даних у базі немає (транзакцію скасовано)", left?.n === 0);

  // Підсумок.
  for (const c of checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}${!c.ok && c.details ? ` (${c.details})` : ""}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length === 0 ? "\nУсе гаразд." : `\nНе пройшло перевірок: ${failed.length}.`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("Помилка:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
