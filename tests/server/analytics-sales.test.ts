import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boxTypes, clients, orderItems, orders } from "@/db/schema";
import { getBoxAnalytics, getDeliveryAnalytics } from "@/server/analytics-sales";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { parseAnalyticsTab } from "@/utils/analyticsParams";
import { makeClient } from "../db/helpers";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("панелі «Бокси» і «Доставки» (B14, D211)", () => {
  let t: OrderTestContext;
  let small: string;
  let long: string;
  let otherClientId: string;
  const period = { from: "2026-10", to: "2026-11" };

  beforeAll(async () => {
    t = await setupOrderTests();
    const byCode = async (code: string) =>
      (await t.db.select().from(boxTypes).where(eq(boxTypes.code, code)))[0]!.id;
    small = await byCode("ours_small_19");
    long = await byCode("ours_long_46");
    await t.db
      .update(clients)
      .set({ managerId: t.users.manager.id })
      .where(eq(clients.id, t.client.id));
    otherClientId = (await makeClient(t.db, { name: "Чужий бар" })).id;
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.update(orders).set({ deletedAt: new Date() });
  });

  const order = async (date: string, overrides: Parameters<typeof t.create>[0] = {}) => {
    const { id } = await t.create({ orderDate: date, ...overrides }, t.users.owner);
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    return id;
  };

  it("вкладка з адреси: невідома стає «Панель»", () => {
    expect(parseAnalyticsTab("boxes")).toBe("boxes");
    expect(parseAnalyticsTab("x")).toBe("panel");
    expect(parseAnalyticsTab(undefined)).toBe("panel");
  });

  it("бокси: кількість і сума по місяцях, типах, клієнтах; частка у виручці", async () => {
    await order("2026-10-05", { boxSales: [{ boxTypeId: small, qty: 3, price: "500" }] });
    await order("2026-11-06", { boxSales: [{ boxTypeId: long, qty: 1, price: "650" }] });
    await order("2026-11-07");
    const data = await getBoxAnalytics(t.db, t.users.owner, period);
    expect(data.totals).toEqual({ count: 4, uah: "2150.00" });
    expect(data.months.map((m) => [m.month, m.count, m.uah])).toEqual([
      ["2026-10", 3, "1500.00"],
      ["2026-11", 1, "650.00"],
    ]);
    expect(data.byType.map((r) => r.count)).toEqual([3, 1]);
    expect(data.byClient).toHaveLength(1);
    // виручка: 3 замовлення по 2250 + бокси 2150 = 8900
    expect(data.revenueShare).toBeCloseTo((2150 / 8900) * 100, 1);
  });

  it("менеджер: підсумки по компанії, клієнти лише свої", async () => {
    await order("2026-11-06", { boxSales: [{ boxTypeId: small, qty: 1, price: "500" }] });
    await order("2026-11-06", {
      clientId: otherClientId,
      boxSales: [{ boxTypeId: small, qty: 5, price: "500" }],
    });
    const data = await getBoxAnalytics(t.db, t.users.manager, period);
    expect(data.totals.count).toBe(6);
    expect(data.byClient.map((r) => r.count)).toEqual([1]);
    expect(JSON.stringify(data)).not.toContain("Чужий бар");
  });

  it("без боксів: нулі й порожні розрізи", async () => {
    await order("2026-11-06");
    const data = await getBoxAnalytics(t.db, t.users.accountant, period);
    expect(data.totals.count).toBe(0);
    expect(data.byType).toEqual([]);
    expect(data.revenueShare).toBe(0);
  });

  it("доставки: способи по місяцях і локаціях, частка з доставкою, платна доставка", async () => {
    const pickup = await order("2026-10-02", { deliveryMethod: "pickup" });
    const own = await order("2026-11-02", {
      deliveryMethod: "our_delivery",
      deliveryText: "вул. 1",
    });
    await order("2026-11-03", { deliveryMethod: "np" });
    await order("2026-11-04", {
      deliveryMethod: "our_delivery",
      locationId: t.otherLocation,
      deliveryText: "x",
    });
    await t.db.insert(orderItems).values({
      orderId: own,
      kind: "delivery",
      title: "Доставка",
      qty: "1",
      unit: "послуга",
      price: "150",
    });
    const data = await getDeliveryAnalytics(t.db, t.users.owner, period);
    expect(data).toMatchObject({ orders: 4, delivered: 3, deliveredShare: 75, paid: "150.00" });
    expect(data.counts).toMatchObject({ pickup: 1, our_delivery: 2, np: 1 });
    expect(data.months[0]!.counts.pickup).toBe(1);
    expect(data.months[1]!.paid).toBe("150.00");
    expect(data.byLocation).toHaveLength(2);
    expect(data.byClient.every((r) => r.delivered > 0 || Number(r.paid) > 0)).toBe(true);
    expect(pickup).toBeTruthy();
  });

  it("доставки: локація звужує, менеджер бачить лише своїх клієнтів", async () => {
    await order("2026-11-02", { deliveryMethod: "np" });
    await order("2026-11-02", {
      deliveryMethod: "np",
      clientId: otherClientId,
      locationId: t.otherLocation,
    });
    const one = await getDeliveryAnalytics(t.db, t.users.owner, {
      ...period,
      locationId: t.otherLocation,
    });
    expect(one.orders).toBe(1);
    const manager = await getDeliveryAnalytics(t.db, t.users.manager, period);
    expect(manager.orders).toBe(2);
    expect(manager.byClient).toHaveLength(1);
  });

  it("права: власник, менеджер, бухгалтер", async () => {
    for (const role of USER_ROLES) {
      for (const attempt of [
        getBoxAnalytics(t.db, t.users[role], period),
        getDeliveryAnalytics(t.db, t.users[role], period),
      ]) {
        if (["owner", "manager", "accountant"].includes(role))
          await expect(attempt, role).resolves.toBeTruthy();
        else await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
      }
    }
  });
});
