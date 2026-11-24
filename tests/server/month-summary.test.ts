import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bankAccounts, orders, paymentMatches, payments } from "@/db/schema";
import { recordCashEntry } from "@/server/cash";
import { exportMonthSummary } from "@/server/export";
import { runExport } from "@/server/export-request";
import { ForbiddenError } from "@/server/guards";
import { getMonthSummary, monthBounds } from "@/server/month-summary";
import { transitionOrder } from "@/server/order-status";
import { matchPaymentToOrders } from "@/server/payments";
import { USER_ROLES } from "@/server/permissions";
import { formatDaySummary } from "@/server/telegram/daily-report";
import { ValidationError } from "@/server/errors";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";
import { readXlsx } from "./xlsx-reader";

describe("зведення за місяць (B13, ТЗ 6.10)", () => {
  let t: OrderTestContext;
  let accountId: string;
  const MONTH = "2026-11";
  const DATE = "2026-11-13";

  beforeAll(async () => {
    t = await setupOrderTests();
    const [account] = await t.db
      .insert(bankAccounts)
      .values({ accountId: "fop-sum", label: "ФОП" })
      .returning({ id: bankAccounts.id });
    accountId = account!.id;
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(paymentMatches);
    await t.db.delete(payments);
    await t.db.update(orders).set({ deletedAt: new Date() });
  });

  const order = async (
    until: "draft" | "confirmed" | "shipped" = "shipped",
    overrides: Parameters<typeof t.create>[0] = {},
  ) => {
    const { id } = await t.create(
      { orderDate: DATE, paymentKind: "fop", ...overrides },
      t.users.owner,
    );
    if (until === "draft") return id;
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    if (until === "shipped") {
      await transitionOrder(t.db, t.users.owner, id, "in_production");
      await transitionOrder(t.db, t.users.owner, id, "packed");
      await transitionOrder(t.db, t.users.owner, id, "shipped");
    }
    return id;
  };

  it("межі місяця", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02").to).toBe("2028-02-29");
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(() => monthBounds("2026-13")).toThrow(ValidationError);
    expect(() => monthBounds("листопад")).toThrow(ValidationError);
  });

  it("дохід це сума замовлень місяця за зафіксованими цінами; без чернеток, скасованих і чужих місяців", async () => {
    await order();
    await order("confirmed", { kgSold: 10 });
    await order("draft");
    const cancelled = await order("confirmed");
    await transitionOrder(t.db, t.users.owner, cancelled, "cancelled", { note: "тест" });
    await order("shipped", { orderDate: "2026-10-30" });
    const summary = await getMonthSummary(t.db, t.users.accountant, { month: MONTH });
    expect(summary.totals).toMatchObject({
      orders: 2,
      kg: "40",
      ice: "3000.00",
      total: "3000.00",
      paid: "0.00",
      debt: "3000.00",
    });
    expect(summary.clients).toHaveLength(1);
    expect(summary.clients[0]).toMatchObject({
      clientName: "Кафе Тест",
      orders: 2,
      total: "3000.00",
    });
    expect(summary.locations[0]).toMatchObject({ orders: 2 });
  });

  it("оплачено: готівка, платіж з банку й статус «Оплачено»; сторнована готівка не рахується", async () => {
    const a = await order("shipped", { paymentKind: "cash" });
    const b = await order();
    const c = await order();
    await recordCashEntry(t.db, t.users.owner, { orderId: a, amount: "1000" });
    const [payment] = await t.db
      .insert(payments)
      .values({
        bankAccountId: accountId,
        externalId: "s-1",
        occurredAt: new Date(),
        amount: "500.00",
      })
      .returning({ id: payments.id });
    await matchPaymentToOrders(t.db, t.users.owner, payment!.id, [b]);
    const [full] = await t.db
      .insert(payments)
      .values({
        bankAccountId: accountId,
        externalId: "s-2",
        occurredAt: new Date(),
        amount: "2250.00",
      })
      .returning({ id: payments.id });
    await matchPaymentToOrders(t.db, t.users.owner, full!.id, [c]);
    const summary = await getMonthSummary(t.db, t.users.owner, { month: MONTH });
    expect(summary.totals).toMatchObject({
      orders: 3,
      total: "6750.00",
      paid: "3750.00",
      debt: "3000.00",
    });
  });

  it("лід, доставка, бокси й інші товари розкладені по видах позицій", async () => {
    await order();
    const summary = await getMonthSummary(t.db, t.users.owner, { month: MONTH });
    expect(summary.totals).toMatchObject({
      ice: "2250.00",
      delivery: "0.00",
      boxes: "0.00",
      other: "0.00",
    });
  });

  it("локація: фільтр звужує зведення; підсумки по локаціях", async () => {
    await order();
    await order("shipped", { locationId: t.otherLocation });
    const all = await getMonthSummary(t.db, t.users.owner, { month: MONTH });
    expect(all.locations).toHaveLength(2);
    const one = await getMonthSummary(t.db, t.users.owner, {
      month: MONTH,
      locationId: t.otherLocation,
    });
    expect(one.totals.orders).toBe(1);
    expect(one.locationId).toBe(t.otherLocation);
  });

  it("бачать лише власник і бухгалтер", async () => {
    for (const role of USER_ROLES) {
      const attempt = getMonthSummary(t.db, t.users[role], { month: MONTH });
      if (role === "owner" || role === "accountant")
        await expect(attempt, role).resolves.toBeTruthy();
      else await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("експорт: два аркуші з рядком «Разом», запис у журнал експортів, права", async () => {
    await order();
    await order("confirmed", { kgSold: 10 });
    const file = await exportMonthSummary(t.db, t.users.accountant, { month: MONTH });
    expect(file.kind).toBe("month_summary");
    expect(file.fileName).toBe("icelab-month-summary-2026-11.xlsx");
    const book = readXlsx(new Uint8Array(file.buffer));
    expect(book.sheets.map((s) => s.name)).toEqual(["По клієнтах", "По локаціях"]);
    const rows = book.sheets[0]!.rows;
    expect(rows[0]!.A!.value).toBe("Код клієнта");
    expect(rows.at(-1)!.B!.value).toBe("Разом");
    expect(rows.at(-1)!.I!.value).toBe(3000);
    // адреса експорту читає місяць з параметрів
    const viaRequest = await runExport(t.db, t.users.owner, "month-summary", { month: MONTH });
    expect(viaRequest.rowCount).toBe(file.rowCount);
    await expect(
      exportMonthSummary(t.db, t.users.manager, { month: MONTH }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("вечірнє зведення: рядок про нерозпізнані платежі лише коли вони є", () => {
    expect(formatDaySummary("2026-11-23", [], undefined, { unmatchedPayments: 3 })).toContain(
      "Нерозпізнаних платежів: 3",
    );
    expect(formatDaySummary("2026-11-23", [], undefined, { unmatchedPayments: 0 })).not.toContain(
      "Нерозпізнаних",
    );
    expect(formatDaySummary("2026-11-23", [])).not.toContain("Нерозпізнаних");
  });
});
