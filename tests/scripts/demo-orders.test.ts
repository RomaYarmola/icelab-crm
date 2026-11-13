import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cashEntries, orderItems, orders, orderStatusHistory } from "@/db/schema";
import { seedReferenceData } from "@/db/seed";
import { findForbiddenFields } from "@/server/dto";
import type { AppUser } from "@/server/guards";
import { listCashDay } from "@/server/cash";
import { listOrders } from "@/server/orders";
import { addDays, todayIso } from "@/utils/isoDate";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAppUsers, makeClient } from "../db/helpers";
import {
  addDemoCash,
  addDemoOrders,
  DEMO_CASH_MARK,
  DEMO_CASH_ORDERS,
  DEMO_ORDER_MARK,
  DEMO_ORDERS,
  removeDemoOrders,
} from "../../scripts/_demo-orders";

describe("демонстраційні замовлення (D59)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let owner: AppUser;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
    owner = (await makeAppUsers(db)).owner;
    for (let i = 1; i <= 4; i++) await makeClient(db, { name: `Тест: Клієнт ${i}` });
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const demoRows = () =>
    db
      .select()
      .from(orders)
      .where(like(orders.internalComment, `${DEMO_ORDER_MARK}%`));

  it("без демо-клієнтів зрозуміла помилка", async () => {
    const empty = await createTestDb();
    await seedReferenceData(empty.db);
    const user = (await makeAppUsers(empty.db)).owner;
    await expect(addDemoOrders(empty.db, user)).rejects.toThrow("спершу npm run clients:seed-dev");
    await empty.client.close();
  });

  it("додає замовлення у різних статусах і на різні дні", async () => {
    const result = await addDemoOrders(db, owner);
    expect(result).toEqual({ added: DEMO_ORDERS.length, skipped: false });
    const rows = await demoRows();
    expect(rows).toHaveLength(DEMO_ORDERS.length);
    const statuses = new Set(rows.map((row) => row.status));
    for (const status of [
      "draft",
      "confirmed",
      "in_production",
      "packed",
      "shipped",
      "closed",
      "cancelled",
    ] as const) {
      expect(statuses.has(status), status).toBe(true);
    }
    expect(new Set(rows.map((row) => row.orderDate)).size).toBeGreaterThan(5);
    expect(new Set(rows.map((row) => row.locationId)).size).toBe(2);
  });

  it("підтверджені мають зафіксовану ціну, скасоване причину, оплачені закриті самі", async () => {
    for (const row of await demoRows()) {
      if (row.status !== "draft" && row.status !== "cancelled") {
        expect(row.pricePerKgSnapshot, `№${row.number}`).not.toBeNull();
      }
      if (row.status === "cancelled") expect(row.cancelReason).toContain("демо");
    }
    const closed = (await demoRows()).filter((row) => row.status === "closed");
    expect(closed.length).toBeGreaterThan(0);
    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, closed[0]!.id));
    expect(history.map((h) => h.toStatus)).toEqual([
      "draft",
      "confirmed",
      "in_production",
      "packed",
      "shipped",
      "paid",
      "closed",
    ]);
  });

  it("є замовлення з доставкою як позицією, суми збігаються з позиціями", async () => {
    const items = await db.select().from(orderItems);
    expect(items.some((item) => item.kind === "delivery")).toBe(true);
    const withFee = (await demoRows()).find(
      (row) =>
        row.total !== `${Number(row.kgSold) * Number(row.pricePerKgSnapshot ?? 0)}.00` &&
        row.pricePerKgSnapshot,
    );
    expect(withFee).toBeDefined();
  });

  it("є навмисний дубль: два замовлення одного клієнта на ту саму дату й тип льоду", async () => {
    const rows = await demoRows();
    const key = (row: (typeof rows)[number]) => `${row.clientId}|${row.orderDate}|${row.iceTypeId}`;
    const counts = new Map<string, number>();
    for (const row of rows)
      if (row.status !== "cancelled") counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
    expect([...counts.values()].some((n) => n >= 2)).toBe(true);
  });

  it("старший локації бачить їх без грошей", async () => {
    const lead = (await makeAppUsers(db)).location_lead;
    const page = await listOrders(db, lead, { limit: 100 });
    expect(findForbiddenFields(page, "location_lead")).toEqual([]);
  });

  it("повторний запуск нічого не додає", async () => {
    const before = (await demoRows()).length;
    expect(await addDemoOrders(db, owner)).toEqual({ added: 0, skipped: true });
    expect((await demoRows()).length).toBe(before);
  });

  it("--remove видаляє лише демо-замовлення з позиціями й історією, чужі лишає", async () => {
    const stranger = await makeClient(db, { name: "Справжній клієнт" });
    const real = await db
      .insert(orders)
      .values({
        clientId: stranger.id,
        locationId: (await demoRows())[0]!.locationId,
        orderDate: "2026-11-01",
        internalComment: "Справжнє",
      })
      .returning();
    const result = await removeDemoOrders(db);
    expect(result.removed).toBe(DEMO_ORDERS.length);
    expect(await demoRows()).toHaveLength(0);
    expect(await db.select().from(orders).where(eq(orders.id, real[0]!.id))).toHaveLength(1);
    const orphanHistory = await db.select().from(orderStatusHistory);
    expect(orphanHistory.every((h) => h.orderId === real[0]!.id)).toBe(true);
  });

  it("після видалення можна додати знову", async () => {
    expect((await addDemoOrders(db, owner)).added).toBe(DEMO_ORDERS.length);
    await removeDemoOrders(db);
  });
});

describe("демонстраційна готівка (B6, D71)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let owner: AppUser;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
    owner = (await makeAppUsers(db)).owner;
    for (let i = 1; i <= 4; i++) await makeClient(db, { name: `Тест: Клієнт ${i}` });
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const cashOrders = () =>
    db
      .select()
      .from(orders)
      .where(like(orders.internalComment, `${DEMO_CASH_MARK}%`));

  it("додає замовлення з готівкою й записи: часткова оплата, сторно, повна оплата", async () => {
    const result = await addDemoCash(db, owner);
    expect(result).toEqual({ added: DEMO_CASH_ORDERS.length, entries: 4, skipped: false });
    const rows = await cashOrders();
    expect(rows).toHaveLength(DEMO_CASH_ORDERS.length);
    expect(rows.every((row) => row.paymentKind === "cash")).toBe(true);
    // Повністю сплачене саме стало «Закрито»; решта ще чекає готівки.
    expect(rows.filter((row) => row.status === "closed")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "shipped")).toHaveLength(2);

    const entries = await db.select().from(cashEntries);
    expect(entries).toHaveLength(4);
    expect(entries.filter((entry) => entry.reversedAt !== null)).toHaveLength(1);
    expect(entries.filter((entry) => entry.enteredVia === "driver_bot")).toHaveLength(1);
  });

  it("екран готівки показує це старшому локації без заборонених полів", async () => {
    const users = await makeAppUsers(db);
    const day = await listCashDay(db, users.owner, { date: addDays(todayIso(), 0) });
    expect(day.orders.length).toBeGreaterThanOrEqual(4);
    expect(Number(day.summary.expectedSum)).toBeGreaterThan(0);
    expect(findForbiddenFields(day, "location_lead")).toEqual([]);
  });

  it("повторний запуск нічого не додає", async () => {
    expect(await addDemoCash(db, owner)).toEqual({ added: 0, entries: 0, skipped: true });
  });

  it("видалення прибирає демо-готівку разом із записами, а тригер захисту знову вмикається", async () => {
    const removed = await removeDemoOrders(db);
    expect(removed.removed).toBe(DEMO_CASH_ORDERS.length);
    expect(await cashOrders()).toHaveLength(0);
    expect(await db.select().from(cashEntries)).toHaveLength(0);

    // Захист записів знову діє: після видалення запис не можна ні змінити, ні видалити.
    await addDemoCash(db, owner);
    const [entry] = await db.select().from(cashEntries).limit(1);
    await expect(db.delete(cashEntries).where(eq(cashEntries.id, entry!.id))).rejects.toThrow();
    await removeDemoOrders(db);
  });

  it("без демо-клієнтів зрозуміла помилка", async () => {
    const empty = await createTestDb();
    await seedReferenceData(empty.db);
    const user = (await makeAppUsers(empty.db)).owner;
    await expect(addDemoCash(empty.db, user)).rejects.toThrow("спершу npm run clients:seed-dev");
    await empty.client.close();
  });
});
