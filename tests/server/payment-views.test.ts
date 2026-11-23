import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bankAccounts, orders, paymentMatches, payments } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import {
  countQueue,
  listOrderPayments,
  listQueue,
  listStatement,
  PAGE_SIZE,
} from "@/server/payment-views";
import { matchPaymentManually } from "@/server/payments";
import { findForbiddenFields } from "@/server/dto";
import { USER_ROLES } from "@/server/permissions";
import { parsePaymentParams } from "@/utils/paymentParams";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("екран «Оплати»: виписка й черга (B13)", () => {
  let t: OrderTestContext;
  let accountId: string;
  let seq = 0;

  beforeAll(async () => {
    t = await setupOrderTests();
    const [account] = await t.db
      .insert(bankAccounts)
      .values({ accountId: "fop-views", label: "ФОП" })
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

  const pay = async (over: Partial<typeof payments.$inferInsert> = {}) => {
    seq += 1;
    const [created] = await t.db
      .insert(payments)
      .values({
        bankAccountId: accountId,
        externalId: `v-${seq}`,
        occurredAt: new Date(),
        amount: "2250.00",
        counterName: "Кафе Тест",
        ...over,
      })
      .returning({ id: payments.id });
    return created!.id;
  };
  const shippedOrder = async () => {
    const { id } = await t.create({
      paymentKind: "fop",
      orderDate: new Date().toISOString().slice(0, 10),
    });
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    return id;
  };

  it("параметри адреси: некоректне відкидається", () => {
    expect(parsePaymentParams({})).toMatchObject({ tab: "queue", status: null, page: 1 });
    expect(
      parsePaymentParams({
        tab: "statement",
        status: "auto",
        from: "2026-11-01",
        min: "100,5",
        page: "3",
      }),
    ).toMatchObject({ tab: "statement", status: "auto", from: "2026-11-01", min: 100.5, page: 3 });
    expect(
      parsePaymentParams({ tab: "x", status: "y", from: "11.11", min: "abc", page: "-2" }),
    ).toMatchObject({ tab: "queue", status: null, from: null, min: null, page: 1 });
  });

  it("виписка: фільтри за статусом, сумою й днем, найновіші першими, сторінки", async () => {
    await pay({ amount: "100.00", occurredAt: new Date("2026-11-10T09:00:00Z") });
    await pay({
      amount: "500.00",
      occurredAt: new Date("2026-11-12T09:00:00Z"),
      matchStatus: "ignored",
      ignoredReason: "свої",
    });
    await pay({ amount: "900.00", occurredAt: new Date("2026-11-14T09:00:00Z") });
    const base = { status: null, from: null, to: null, min: null, max: null, page: 1 };
    const all = await listStatement(t.db, t.users.owner, base);
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.amount)).toEqual(["900.00", "500.00", "100.00"]);
    expect(
      (await listStatement(t.db, t.users.owner, { ...base, status: "ignored" })).rows,
    ).toHaveLength(1);
    expect(
      (await listStatement(t.db, t.users.owner, { ...base, min: 200, max: 600 })).rows.map(
        (r) => r.amount,
      ),
    ).toEqual(["500.00"]);
    expect(
      (await listStatement(t.db, t.users.owner, { ...base, from: "2026-11-11", to: "2026-11-13" }))
        .rows,
    ).toHaveLength(1);
    expect((await listStatement(t.db, t.users.owner, { ...base, page: 2 })).rows).toEqual([]);
    expect(PAGE_SIZE).toBeGreaterThan(0);
  });

  it("у відповідях немає сирої відповіді банку й рахунку платника", async () => {
    await pay({ counterIban: "UA123", raw: { secret: 1 } });
    const page = await listStatement(t.db, t.users.owner, {
      status: null,
      from: null,
      to: null,
      min: null,
      max: null,
      page: 1,
    });
    expect(JSON.stringify(page)).not.toMatch(/UA123|secret/);
    expect(findForbiddenFields(page, "owner")).toEqual([]);
  });

  it("черга: підказки за платником, сумою й номером; розкладений платіж зі залишком лишається", async () => {
    const id = await shippedOrder();
    const number = (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!.number;
    await pay({ comment: `оплата замовлення ${number}`, amount: "1000.00", counterName: "Хтось" });
    const queue = await listQueue(t.db, t.users.accountant);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.suggestions[0]).toMatchObject({
      orderId: id,
      reasons: ["number"],
      apply: "1000.00",
      remaining: "2250.00",
    });
    expect(await countQueue(t.db, t.users.owner)).toBe(1);

    await matchPaymentManually(t.db, t.users.owner, queue[0]!.payment.id, [
      { orderId: id, amount: "1000" },
    ]);
    const again = await listQueue(t.db, t.users.owner);
    // платіж розкладено повністю (1000 з 1000): у черзі його вже немає
    expect(again).toEqual([]);
    expect(await listOrderPayments(t.db, t.users.owner, id)).toHaveLength(1);
  });

  it("часткове зіставлення лишає платіж у черзі без повторної підказки того ж замовлення", async () => {
    const id = await shippedOrder();
    const p = await pay({ amount: "3000.00" });
    await matchPaymentManually(t.db, t.users.owner, p, [{ orderId: id, amount: "2250" }]);
    const queue = await listQueue(t.db, t.users.owner);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.payment.unallocated).toBe("750.00");
    expect(queue[0]!.suggestions.map((s) => s.orderId)).not.toContain(id);
  });

  it("читають лише власник і бухгалтер", async () => {
    for (const role of USER_ROLES) {
      const attempt = listQueue(t.db, t.users[role]);
      if (role === "owner" || role === "accountant")
        await expect(attempt, role).resolves.toBeTruthy();
      else await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
