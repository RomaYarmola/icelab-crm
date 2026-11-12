import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/db/actor";
import { auditLog, orderPriceChanges, orders } from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";
import { makeClient, makeLocation, makeOrder, makeProfile, pgErrorCode } from "./helpers";

const CHECK_VIOLATION = "23514";

describe("замовлення: обмеження й зміни ціни (міграція 0009)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let clientId: string;
  let locationId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    clientId = (await makeClient(db)).id;
    locationId = (await makeLocation(db)).id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const draft = () => makeOrder(db, { clientId, locationId });

  describe("підтверджене замовлення має зафіксовану ціну (D52)", () => {
    it("чернетка і скасоване (з причиною) ціни не потребують", async () => {
      const order = await draft();
      expect(order.pricePerKgSnapshot).toBeNull();
      await db
        .update(orders)
        .set({ status: "cancelled", cancelReason: "Клієнт передумав" })
        .where(eq(orders.id, order.id));
    });

    it("підтвердити, виробляти, запакувати й далі без ціни не можна", async () => {
      for (const status of [
        "confirmed",
        "in_production",
        "packed",
        "shipped",
        "paid",
        "closed",
      ] as const) {
        const order = await draft();
        const result = await pgErrorCode(
          db.update(orders).set({ status }).where(eq(orders.id, order.id)),
        );
        expect(result, status).toBe(CHECK_VIOLATION);
      }
    });

    it("з ціною підтвердження проходить", async () => {
      const order = await draft();
      await db
        .update(orders)
        .set({ status: "confirmed", pricePerKgSnapshot: "75" })
        .where(eq(orders.id, order.id));
      const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
      expect(row?.status).toBe("confirmed");
    });

    it("імпортований архів (B7) цього правила не стосується", async () => {
      const row = await makeOrder(db, { clientId, locationId, status: "closed", isArchive: true });
      expect(row.pricePerKgSnapshot).toBeNull();
    });
  });

  describe("скасування має причину (D51)", () => {
    it("без причини чи з порожньою причиною не проходить", async () => {
      for (const cancelReason of [null, "", "   "]) {
        const order = await draft();
        const result = await pgErrorCode(
          db
            .update(orders)
            .set({ status: "cancelled", cancelReason })
            .where(eq(orders.id, order.id)),
        );
        expect(result, String(cancelReason)).toBe(CHECK_VIOLATION);
      }
    });

    it("архівне скасоване без причини дозволене", async () => {
      const row = await makeOrder(db, {
        clientId,
        locationId,
        status: "cancelled",
        isArchive: true,
      });
      expect(row.cancelReason).toBeNull();
    });
  });

  describe("зміни ціни підтвердженого замовлення", () => {
    it("записуються з автором і потрапляють у журнал змін", async () => {
      const owner = await makeProfile(db, { role: "owner", fullName: "Власник цін" });
      const order = await draft();
      const change = await withActor(db, owner.id, async (tx) => {
        const [row] = await tx
          .insert(orderPriceChanges)
          .values({
            orderId: order.id,
            oldPrice: "75",
            newPrice: "70",
            note: "Домовились про знижку",
            changedBy: owner.id,
          })
          .returning();
        return row!;
      });
      expect(change.note).toBe("Домовились про знижку");
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "order_price_changes"), eq(auditLog.rowId, change.id)));
      expect(rows.map((row) => row.action)).toEqual(["insert"]);
      expect(rows[0]?.actorId).toBe(owner.id);
    });

    it("без примітки, з порожньою приміткою чи від'ємною ціною не проходить", async () => {
      const order = await draft();
      const base = { orderId: order.id, oldPrice: "75", newPrice: "70" };
      expect(await pgErrorCode(db.insert(orderPriceChanges).values({ ...base, note: "  " }))).toBe(
        CHECK_VIOLATION,
      );
      expect(
        await pgErrorCode(
          db.insert(orderPriceChanges).values({ ...base, newPrice: "-1", note: "ок" }),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it("видаляються разом із замовленням", async () => {
      const order = await draft();
      await db
        .insert(orderPriceChanges)
        .values({ orderId: order.id, oldPrice: "75", newPrice: "70", note: "тест" });
      await db.delete(orders).where(eq(orders.id, order.id));
      const left = await db
        .select()
        .from(orderPriceChanges)
        .where(eq(orderPriceChanges.orderId, order.id));
      expect(left).toHaveLength(0);
    });
  });

  it("є індекс для пошуку дублів і «як минулого разу»", async () => {
    const result = await db.execute(
      sql`select indexname from pg_indexes where schemaname = 'public' and tablename = 'orders'`,
    );
    const names = (result.rows as { indexname: string }[]).map((row) => row.indexname);
    expect(names).toContain("orders_client_date_idx");
  });
});
