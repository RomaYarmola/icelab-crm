import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clients, orders } from "@/db/schema";
import { getAnalytics, monthRange, shiftMonth } from "@/server/analytics";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { getMonthSummary } from "@/server/month-summary";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { shiftMonthLabel } from "@/components/analyticsPage/trend";
import { parseAnalyticsParams } from "@/utils/analyticsParams";
import { changeDefaultPrice } from "@/server/prices";
import { makeClient } from "../db/helpers";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("панель аналітики (B14, ТЗ 6.11, D204, D205)", () => {
  let t: OrderTestContext;
  let otherClientId: string;

  beforeAll(async () => {
    t = await setupOrderTests();
    // Клієнт менеджера (його власний) і чужий.
    await t.db
      .update(clients)
      .set({ managerId: t.users.manager.id })
      .where(eq(clients.id, t.client.id));
    const other = await makeClient(t.db, { name: "Чужий бар" });
    otherClientId = other.id;
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.update(orders).set({ deletedAt: new Date() });
  });

  const order = async (
    date: string,
    kg: number,
    overrides: Parameters<typeof t.create>[0] = {},
    confirm = true,
  ) => {
    const { id } = await t.create({ orderDate: date, kgSold: kg, ...overrides }, t.users.owner);
    if (confirm) await transitionOrder(t.db, t.users.owner, id, "confirmed");
    return id;
  };
  const period = { from: "2026-09", to: "2026-11" };

  it("місяці: зсув і перелік з межами", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthRange("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(() => monthRange("2026-12", "2026-01")).toThrow(ValidationError);
    expect(() => monthRange("2020-01", "2026-01")).toThrow(/24/);
    expect(() => monthRange("x", "2026-01")).toThrow(ValidationError);
  });

  it("параметри адреси: типово 6 місяців; некоректне й задовгий період виправляються", () => {
    expect(parseAnalyticsParams({}, "2026-11-25")).toEqual({ from: "2026-06", to: "2026-11" });
    expect(parseAnalyticsParams({ from: "x", to: "y" }, "2026-11-25")).toEqual({
      from: "2026-06",
      to: "2026-11",
    });
    expect(parseAnalyticsParams({ from: "2026-12", to: "2026-03" }, "2026-11-25")).toEqual({
      from: "2026-03",
      to: "2026-03",
    });
    expect(parseAnalyticsParams({ from: "2020-01", to: "2026-11" }, "2026-11-25").from).toBe(
      "2024-12",
    );
  });

  it("кг клієнта за місяць дорівнює сумі «кг на продаж» його замовлень (критерій ТЗ)", async () => {
    await order("2026-11-03", 30);
    await order("2026-11-20", 12);
    await order("2026-10-15", 10);
    const data = await getAnalytics(t.db, t.users.owner, period);
    const mine = data.clients.find((c) => c.clientId === t.client.id)!;
    expect(mine.lastMonth.kg).toBe(42);
    expect(mine.previousMonth.kg).toBe(10);
    expect(mine.kg).toBe(52);
    expect(data.months.map((m) => [m.month, m.kg])).toEqual([
      ["2026-09", 0],
      ["2026-10", 10],
      ["2026-11", 42],
    ]);
  });

  it("без чернеток, скасованих і місяців поза періодом; суми збігаються зі «Зведенням за місяць»", async () => {
    await order("2026-11-03", 30);
    await order("2026-11-04", 99, {}, false);
    const cancelled = await order("2026-11-05", 5);
    await transitionOrder(t.db, t.users.owner, cancelled, "cancelled", { note: "тест" });
    await order("2026-08-31", 50);
    const data = await getAnalytics(t.db, t.users.owner, { from: "2026-11", to: "2026-11" });
    const summary = await getMonthSummary(t.db, t.users.owner, { month: "2026-11" });
    expect(data.totals).toEqual({ orders: 1, kg: 30, uah: summary.totals.total });
    expect(data.months).toHaveLength(1);
  });

  it("динаміка бачить місяць перед періодом, навіть коли період один місяць", async () => {
    await order("2026-10-02", 20);
    await order("2026-11-02", 30);
    const data = await getAnalytics(t.db, t.users.owner, { from: "2026-11", to: "2026-11" });
    expect(data.totals.kg).toBe(30);
    expect(data.clients[0]!.previousMonth.kg).toBe(20);
  });

  it("менеджер: загальні підсумки по компанії, а клієнти й менеджери лише свої", async () => {
    await order("2026-11-02", 30);
    await order("2026-11-02", 70, { clientId: otherClientId });
    const owner = await getAnalytics(t.db, t.users.owner, period);
    const manager = await getAnalytics(t.db, t.users.manager, period);
    expect(owner.clients).toHaveLength(2);
    expect(manager.ownOnly).toBe(true);
    expect(manager.totals).toEqual(owner.totals);
    expect(manager.clients.map((c) => c.clientId)).toEqual([t.client.id]);
    expect(manager.byManager).toHaveLength(1);
    expect(manager.byManager[0]!.kg).toBe(30);
    expect(JSON.stringify(manager)).not.toContain("Чужий бар");
    expect(owner.byManager.map((r) => r.label)).toContain("Не вказано");
  });

  it("розрізи по типах льоду, застосуванню й джерелах сходяться з підсумком", async () => {
    await order("2026-11-02", 30);
    await changeDefaultPrice(t.db, t.users.owner, {
      iceTypeId: t.ice3,
      pricePerKg: "50",
      validFrom: "2026-01-01",
    });
    await order("2026-11-02", 10, { iceTypeId: t.ice3 });
    const data = await getAnalytics(t.db, t.users.accountant, period);
    for (const slice of [data.byIceType, data.byApplication, data.bySource]) {
      expect(slice.reduce((sum, r) => sum + r.kg, 0)).toBe(data.totals.kg);
    }
    expect(data.byIceType).toHaveLength(2);
  });

  it("локація звужує дані", async () => {
    await order("2026-11-02", 30);
    await order("2026-11-02", 70, { locationId: t.otherLocation });
    const one = await getAnalytics(t.db, t.users.owner, { ...period, locationId: t.otherLocation });
    expect(one.totals.kg).toBe(70);
  });

  it("права: власник, менеджер, бухгалтер; решта ні", async () => {
    for (const role of USER_ROLES) {
      const attempt = getAnalytics(t.db, t.users[role], period);
      if (["owner", "manager", "accountant"].includes(role)) {
        await expect(attempt, role).resolves.toBeTruthy();
      } else await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("динаміка словами", () => {
    const m = (uah: string) => ({ orders: 1, kg: 1, uah });
    expect(shiftMonthLabel("2026-11", m("120"), m("100"))).toMatch(/^\+20 % до/);
    expect(shiftMonthLabel("2026-11", m("50"), m("100"))).toMatch(/^−50 % до/);
    expect(shiftMonthLabel("2026-11", m("100"), m("100"))).toMatch(/стільки ж/);
    expect(shiftMonthLabel("2026-11", m("100"), m("0"))).toMatch(/^нове проти/);
    expect(shiftMonthLabel("2026-11", m("0"), m("0"))).toMatch(/замовлень не було/);
  });
});
