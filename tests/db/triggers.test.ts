import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/db/actor";
import { auditLog, clients, orderItems, orders, orderStatusHistory, settings } from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";
import { makeClient, makeLocation, makeOrder, makeProfile } from "./helpers";

describe("тригери", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let locationId: string;
  let actorId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    locationId = (await makeLocation(db)).id;
    actorId = (await makeProfile(db, { fullName: "Менеджер" })).id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  async function totalOf(orderId: string) {
    const [row] = await db
      .select({ total: orders.total })
      .from(orders)
      .where(eq(orders.id, orderId));
    return row?.total;
  }

  describe("сума замовлення", () => {
    it("перераховується при додаванні, зміні й видаленні позицій", async () => {
      const client = await makeClient(db);
      const order = await makeOrder(db, { clientId: client.id, locationId });
      expect(await totalOf(order.id)).toBe("0.00");

      const [a] = await db
        .insert(orderItems)
        .values({ orderId: order.id, kind: "ice", title: "Лід", qty: "2", price: "10.50" })
        .returning();
      await db.insert(orderItems).values({
        orderId: order.id,
        kind: "delivery",
        title: "Доставка",
        qty: "1.5",
        price: "4.00",
      });
      expect(await totalOf(order.id)).toBe("27.00");

      await db.update(orderItems).set({ qty: "3" }).where(eq(orderItems.id, a!.id));
      expect(await totalOf(order.id)).toBe("37.50");

      await db.delete(orderItems).where(eq(orderItems.id, a!.id));
      expect(await totalOf(order.id)).toBe("6.00");

      await db.delete(orderItems).where(eq(orderItems.orderId, order.id));
      expect(await totalOf(order.id)).toBe("0.00");
    });

    it("рахує окремо для кожного замовлення і переносить суму при зміні order_id", async () => {
      const client = await makeClient(db);
      const first = await makeOrder(db, { clientId: client.id, locationId });
      const second = await makeOrder(db, { clientId: client.id, locationId });
      const [item] = await db
        .insert(orderItems)
        .values({ orderId: first.id, kind: "ice", title: "Лід", qty: "1", price: "100" })
        .returning();
      expect(await totalOf(first.id)).toBe("100.00");
      expect(await totalOf(second.id)).toBe("0.00");

      await db.update(orderItems).set({ orderId: second.id }).where(eq(orderItems.id, item!.id));
      expect(await totalOf(first.id)).toBe("0.00");
      expect(await totalOf(second.id)).toBe("100.00");
    });

    it("округлює суму позиції до копійки", async () => {
      const client = await makeClient(db);
      const order = await makeOrder(db, { clientId: client.id, locationId });
      const [item] = await db
        .insert(orderItems)
        .values({ orderId: order.id, kind: "ice", title: "Лід", qty: "1.333", price: "3.00" })
        .returning();
      // 1.333 × 3.00 = 3.999, до копійки це 4.00
      expect(item!.amount).toBe("4.00");
      expect(await totalOf(order.id)).toBe("4.00");
    });
  });

  describe("час зміни і автор запису", () => {
    it("оновлює updated_at при зміні рядка", async () => {
      const client = await makeClient(db);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const [updated] = await db
        .update(clients)
        .set({ notes: "оновлено" })
        .where(eq(clients.id, client.id))
        .returning();
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(client.updatedAt.getTime());
      expect(updated!.createdAt.getTime()).toBe(client.createdAt.getTime());
    });

    it("підставляє автора з withActor, якщо created_by не заданий", async () => {
      const created = await withActor(db, actorId, async (tx) => {
        const [row] = await tx
          .insert(clients)
          .values({ code: "АА1001", name: "Від менеджера" })
          .returning();
        return row!;
      });
      expect(created.createdBy).toBe(actorId);
    });

    it("залишає порожнім автора системної зміни і не перезаписує явного автора", async () => {
      const system = await makeClient(db);
      expect(system.createdBy).toBeNull();

      const other = await makeProfile(db, { fullName: "Інший" });
      const explicit = await withActor(db, actorId, async (tx) => {
        const [row] = await tx
          .insert(clients)
          .values({ code: "АА1002", name: "Явний автор", createdBy: other.id })
          .returning();
        return row!;
      });
      expect(explicit.createdBy).toBe(other.id);
    });
  });

  describe("історія статусів", () => {
    const historyOf = (orderId: string) =>
      db
        .select()
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, orderId))
        .orderBy(orderStatusHistory.changedAt);

    it("пише запис про створення і лише про зміни статусу, з автором і приміткою", async () => {
      const client = await makeClient(db);
      const order = await makeOrder(db, { clientId: client.id, locationId });

      let rows = await historyOf(order.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fromStatus: null, toStatus: "draft", changedBy: null });

      // Зміна іншого поля історії не додає.
      await db.update(orders).set({ comment: "коментар" }).where(eq(orders.id, order.id));
      // Той самий статус теж.
      await db.update(orders).set({ status: "draft" }).where(eq(orders.id, order.id));
      expect(await historyOf(order.id)).toHaveLength(1);

      await withActor(
        db,
        actorId,
        (tx) => tx.update(orders).set({ status: "confirmed" }).where(eq(orders.id, order.id)),
        { note: "Підтверджено клієнтом" },
      );
      rows = await historyOf(order.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        fromStatus: "draft",
        toStatus: "confirmed",
        changedBy: actorId,
        note: "Підтверджено клієнтом",
      });
    });
  });

  describe("журнал змін", () => {
    const auditOf = (table: string, rowId: string) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, table), eq(auditLog.rowId, rowId)))
        .orderBy(auditLog.at);

    it("при створенні пише лише непорожні поля", async () => {
      const client = await makeClient(db, { name: "Журнал створення" });
      const rows = await auditOf("clients", client.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe("insert");
      const diff = rows[0]!.diff as Record<string, { new: unknown }>;
      expect(diff.name).toEqual({ new: "Журнал створення" });
      expect(diff).not.toHaveProperty("created_at");
      expect(diff).not.toHaveProperty("updated_at");
      expect(diff).not.toHaveProperty("notes"); // порожнє поле не пишемо
    });

    it("при зміні пише лише змінені поля зі старим і новим значенням та автора", async () => {
      const client = await makeClient(db, { name: "Стара назва" });
      await withActor(db, actorId, (tx) =>
        tx.update(clients).set({ name: "Нова назва" }).where(eq(clients.id, client.id)),
      );
      const rows = await auditOf("clients", client.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ action: "update", actorId });
      expect(rows[1]!.diff).toEqual({ name: { old: "Стара назва", new: "Нова назва" } });
    });

    it("не пише запис, якщо реально нічого не змінилося", async () => {
      const client = await makeClient(db);
      await db.update(clients).set({ name: client.name }).where(eq(clients.id, client.id));
      expect(await auditOf("clients", client.id)).toHaveLength(1); // лише створення
    });

    it("при видаленні пише старі значення", async () => {
      const client = await makeClient(db, { name: "На видалення" });
      await db.delete(clients).where(eq(clients.id, client.id));
      const rows = await auditOf("clients", client.id);
      expect(rows.at(-1)).toMatchObject({ action: "delete" });
      expect(rows.at(-1)!.diff).toMatchObject({ name: { old: "На видалення" } });
    });

    it("для налаштувань використовує ключ як ідентифікатор рядка", async () => {
      await db.insert(settings).values({ key: "test.threshold", value: 5 });
      await db.update(settings).set({ value: 7 }).where(eq(settings.key, "test.threshold"));
      const rows = await auditOf("settings", "test.threshold");
      expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
      expect(rows[1]!.diff).toEqual({ value: { old: 5, new: 7 } });
    });
  });

  describe("порядок записів, коли кілька змін в одній транзакції", () => {
    // У Postgres now() однаковий у межах транзакції, тому для журналів використовуємо
    // clock_timestamp(): кожен запис має свій час, і порядок не плутається.
    // Годинник у PGlite має точність до мілісекунди, тому між діями робимо коротку паузу
    // (з now() усі записи мали б однаковий час незалежно від пауз).
    const pause = (tx: Pick<TestDb, "execute">) => tx.execute(sql`select pg_sleep(0.01)`);

    it("історія статусів зберігає порядок змін", async () => {
      const client = await makeClient(db);
      const order = await withActor(db, actorId, async (tx) => {
        const [row] = await tx
          .insert(orders)
          .values({ clientId: client.id, locationId, orderDate: "2026-11-09" })
          .returning();
        await pause(tx);
        await tx.update(orders).set({ status: "confirmed" }).where(eq(orders.id, row!.id));
        await pause(tx);
        await tx.update(orders).set({ status: "in_production" }).where(eq(orders.id, row!.id));
        return row!;
      });

      const rows = await db
        .select()
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, order.id))
        .orderBy(orderStatusHistory.changedAt);
      expect(rows.map((r) => r.toStatus)).toEqual(["draft", "confirmed", "in_production"]);

      const distinct = await db.execute(
        sql`select count(distinct changed_at)::int as n from order_status_history where order_id = ${order.id}`,
      );
      expect((distinct.rows[0] as { n: number }).n).toBe(3);
    });

    it("журнал змін зберігає порядок записів", async () => {
      const clientId = await withActor(db, actorId, async (tx) => {
        const [created] = await tx
          .insert(clients)
          .values({ code: "\u0410\u04102001", name: "Один" })
          .returning();
        await pause(tx);
        await tx.update(clients).set({ name: "Два" }).where(eq(clients.id, created!.id));
        await pause(tx);
        await tx.update(clients).set({ name: "Три" }).where(eq(clients.id, created!.id));
        return created!.id;
      });

      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "clients"), eq(auditLog.rowId, clientId)))
        .orderBy(auditLog.at);
      expect(rows.map((r) => r.action)).toEqual(["insert", "update", "update"]);
      expect(rows[2]!.diff).toEqual({ name: { old: "Два", new: "Три" } });

      const distinct = await db.execute(
        sql`select count(distinct at)::int as n from audit_log where row_id = ${clientId}`,
      );
      expect((distinct.rows[0] as { n: number }).n).toBe(3);
    });
  });
});
