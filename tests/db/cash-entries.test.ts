import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/db/actor";
import { auditLog, cashEntries, orders } from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";
import { makeClient, makeLocation, makeOrder, makeProfile, pgErrorCode } from "./helpers";

const CHECK_VIOLATION = "23514";
const INTEGRITY_VIOLATION = "23000";
// ON DELETE RESTRICT дає 23001 (restrict_violation), а не 23503.
const RESTRICT_VIOLATION = "23001";
const NOT_NULL_VIOLATION = "23502";

describe("готівка по замовленню: таблиця cash_entries (міграція 0010, D67, D69)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let orderId: string;
  let locationId: string;
  let leadId: string;
  let ownerId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    const clientId = (await makeClient(db)).id;
    locationId = (await makeLocation(db)).id;
    leadId = (await makeProfile(db, { role: "location_lead", locationId })).id;
    ownerId = (await makeProfile(db, { role: "owner" })).id;
    orderId = (
      await makeOrder(db, {
        clientId,
        locationId,
        status: "shipped",
        pricePerKgSnapshot: "75",
        paymentKind: "cash",
      })
    ).id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const entry = (overrides: Partial<typeof cashEntries.$inferInsert> = {}) => ({
    orderId,
    locationId,
    amount: "500",
    receivedOn: "2026-11-13",
    enteredBy: leadId,
    ...overrides,
  });
  const insertEntry = async (overrides: Partial<typeof cashEntries.$inferInsert> = {}) =>
    (await db.insert(cashEntries).values(entry(overrides)).returning())[0]!;

  describe("обмеження", () => {
    it("запис з сумою, датою й автором проходить; канал за замовчуванням «веб»", async () => {
      const row = await insertEntry({ receivedByText: "Водій Іван", note: "Доставка" });
      expect(row).toMatchObject({
        amount: "500.00",
        enteredVia: "web",
        receivedByText: "Водій Іван",
        reversedAt: null,
      });
    });

    it("сума має бути більшою за нуль", async () => {
      expect(await pgErrorCode(insertEntry({ amount: "0" }))).toBe(CHECK_VIOLATION);
      expect(await pgErrorCode(insertEntry({ amount: "-10" }))).toBe(CHECK_VIOLATION);
    });

    it("автор запису обов'язковий", async () => {
      const result = await pgErrorCode(
        db.insert(cashEntries).values({ ...entry(), enteredBy: undefined as unknown as string }),
      );
      expect(result).toBe(NOT_NULL_VIOLATION);
    });

    it("сторно без причини чи без автора не проходить", async () => {
      const row = await insertEntry();
      expect(
        await pgErrorCode(
          db
            .update(cashEntries)
            .set({ reversedAt: new Date(), reversedBy: ownerId, reversalReason: "  " })
            .where(eq(cashEntries.id, row.id)),
        ),
      ).toBe(CHECK_VIOLATION);
      expect(
        await pgErrorCode(
          db
            .update(cashEntries)
            .set({ reversedAt: new Date(), reversalReason: "Помилка" })
            .where(eq(cashEntries.id, row.id)),
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  describe("гроші це записи, а не поля (D67, D69)", () => {
    it("запис не можна видалити", async () => {
      const row = await insertEntry();
      expect(await pgErrorCode(db.delete(cashEntries).where(eq(cashEntries.id, row.id)))).toBe(
        INTEGRITY_VIOLATION,
      );
      expect(await db.select().from(cashEntries).where(eq(cashEntries.id, row.id))).toHaveLength(1);
    });

    it("суму, замовлення, дату, примітку й автора змінити не можна", async () => {
      const row = await insertEntry();
      const attempts: Partial<typeof cashEntries.$inferInsert>[] = [
        { amount: "1" },
        { orderId: (await makeOrder(db, { clientId: (await makeClient(db)).id, locationId })).id },
        { receivedOn: "2026-11-01" },
        { note: "Інакше" },
        { receivedByText: "Інший" },
        { enteredBy: ownerId },
        { enteredVia: "driver_bot" },
      ];
      for (const set of attempts) {
        expect(
          await pgErrorCode(db.update(cashEntries).set(set).where(eq(cashEntries.id, row.id))),
          JSON.stringify(Object.keys(set)),
        ).toBe(INTEGRITY_VIOLATION);
      }
      expect(
        (await db.select().from(cashEntries).where(eq(cashEntries.id, row.id)))[0],
      ).toMatchObject({ amount: "500.00", note: null });
    });

    it("сторно ставиться один раз; після нього запис лишається, але змінити його вже не можна", async () => {
      const row = await insertEntry();
      await withActor(db, ownerId, (tx) =>
        tx
          .update(cashEntries)
          .set({ reversedAt: new Date(), reversedBy: ownerId, reversalReason: "Помилився сумою" })
          .where(eq(cashEntries.id, row.id)),
      );
      const [after] = await db.select().from(cashEntries).where(eq(cashEntries.id, row.id));
      expect(after).toMatchObject({ reversedBy: ownerId, reversalReason: "Помилився сумою" });
      expect(after!.reversedAt).toBeInstanceOf(Date);

      expect(
        await pgErrorCode(
          db
            .update(cashEntries)
            .set({ reversalReason: "Інша причина" })
            .where(eq(cashEntries.id, row.id)),
        ),
      ).toBe(INTEGRITY_VIOLATION);
    });

    it("замовлення, на яке є запис готівки, видалити з бази не можна", async () => {
      const id = (await makeOrder(db, { clientId: (await makeClient(db)).id, locationId })).id;
      await insertEntry({ orderId: id });
      expect(await pgErrorCode(db.delete(orders).where(eq(orders.id, id)))).toBe(
        RESTRICT_VIOLATION,
      );
    });
  });

  describe("журнал змін (ТЗ 4.9)", () => {
    it("додавання й сторно лишають слід з автором", async () => {
      const row = await withActor(
        db,
        leadId,
        async (tx) =>
          (
            await tx
              .insert(cashEntries)
              .values(entry({ amount: "120.50" }))
              .returning()
          )[0]!,
      );
      await withActor(db, ownerId, (tx) =>
        tx
          .update(cashEntries)
          .set({ reversedAt: new Date(), reversedBy: ownerId, reversalReason: "Не те замовлення" })
          .where(eq(cashEntries.id, row.id)),
      );
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "cash_entries"), eq(auditLog.rowId, row.id)))
        .orderBy(auditLog.at);
      expect(rows.map((r) => [r.action, r.actorId])).toEqual([
        ["insert", leadId],
        ["update", ownerId],
      ]);
      expect(rows[1]!.diff).toMatchObject({ reversal_reason: { new: "Не те замовлення" } });
    });
  });
});
