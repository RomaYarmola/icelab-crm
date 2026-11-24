import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bankAccounts, orders, paymentMatches, payments, settings } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import {
  DEBT_DAYS_KEY,
  getRequisites,
  listDebts,
  listQueue,
  loadDebtDays,
  REQUISITES_KEY,
  setRequisites,
} from "@/server/payment-views";
import { matchPaymentToOrders } from "@/server/payments";
import { USER_ROLES } from "@/server/permissions";
import { ValidationError } from "@/server/errors";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("борги, вибір замовлень, реквізити, пояснення в черзі (B13, D196–D198)", () => {
  let t: OrderTestContext;
  let accountId: string;
  let seq = 0;
  const DAY = 86_400_000;

  beforeAll(async () => {
    t = await setupOrderTests();
    const [account] = await t.db
      .insert(bankAccounts)
      .values({ accountId: "fop-debts", label: "ФОП" })
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
    await t.db.delete(settings).where(eq(settings.key, DEBT_DAYS_KEY));
    await t.db.delete(settings).where(eq(settings.key, REQUISITES_KEY));
  });

  const pay = async (over: Partial<typeof payments.$inferInsert> = {}) => {
    seq += 1;
    const [created] = await t.db
      .insert(payments)
      .values({
        bankAccountId: accountId,
        externalId: `d-${seq}`,
        occurredAt: new Date(),
        amount: "2250.00",
        counterName: "Кафе Тест",
        ...over,
      })
      .returning({ id: payments.id });
    return created!.id;
  };
  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const bankOrder = async (
    until: "confirmed" | "shipped" = "shipped",
    overrides: Parameters<typeof t.create>[0] = {},
  ) => {
    const { id } = await t.create({
      paymentKind: "fop",
      orderDate: new Date().toISOString().slice(0, 10),
      ...overrides,
    });
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    if (until === "shipped") {
      await transitionOrder(t.db, t.users.location_lead, id, "in_production");
      await transitionOrder(t.db, t.users.location_lead, id, "packed");
      await transitionOrder(t.db, t.users.owner, id, "shipped");
    }
    return id;
  };

  describe("борги (D196)", () => {
    it("поріг 1 день: сьогоднішнє відправлення ще не борг, учорашнє вже так", async () => {
      const id = await bankOrder();
      expect(await listDebts(t.db, t.users.accountant)).toEqual([]);
      const debts = await listDebts(t.db, t.users.accountant, new Date(Date.now() + DAY));
      expect(debts).toHaveLength(1);
      expect(debts[0]).toMatchObject({ clientName: "Кафе Тест", total: "2250.00" });
      expect(debts[0]!.orders[0]).toMatchObject({ id, days: 1, remaining: "2250.00" });
    });

    it("не борг: оплачене, готівкове, ще не відправлене; часткова оплата зменшує залишок", async () => {
      await bankOrder("confirmed");
      await bankOrder("shipped", { paymentKind: "cash" });
      const partial = await bankOrder();
      const p = await pay({ amount: "1000.00" });
      await matchPaymentToOrders(t.db, t.users.owner, p, [partial]);
      const later = new Date(Date.now() + 2 * DAY);
      const debts = await listDebts(t.db, t.users.owner, later);
      expect(debts).toHaveLength(1);
      expect(debts[0]!.total).toBe("1250.00");

      const full = await pay({ amount: "1250.00" });
      await matchPaymentToOrders(t.db, t.users.owner, full, [partial]);
      expect(await listDebts(t.db, t.users.owner, later)).toEqual([]);
    });

    it("поріг можна змінити в налаштуванні; найбільший борг першим", async () => {
      await bankOrder();
      await t.db.insert(settings).values({ key: DEBT_DAYS_KEY, value: 3 });
      expect(await loadDebtDays(t.db)).toBe(3);
      expect(await listDebts(t.db, t.users.owner, new Date(Date.now() + 2 * DAY))).toEqual([]);
      expect(await listDebts(t.db, t.users.owner, new Date(Date.now() + 3 * DAY))).toHaveLength(1);
    });

    it("бачать лише власник і бухгалтер", async () => {
      for (const role of USER_ROLES) {
        const attempt = listDebts(t.db, t.users[role]);
        if (role === "owner" || role === "accountant")
          await expect(attempt, role).resolves.toBeTruthy();
        else await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
      }
    });
  });

  describe("вибір замовлень зі списку (платіж без номерів)", () => {
    it("вибрані гасяться по порядку номерів, решта лишається на платежі", async () => {
      const a = await bankOrder();
      const b = await bankOrder();
      const c = await bankOrder();
      const p = await pay({ amount: "5000.00" });
      const result = await matchPaymentToOrders(t.db, t.users.accountant, p, [c, a, b]);
      expect(result.remainingKopecks).toBe(0);
      expect((await row(a)).status).toBe("closed");
      expect((await row(b)).status).toBe("closed");
      expect((await row(c)).status).toBe("shipped");
    });

    it("помилки: нічого не вибрано, чуже/готівкове, повтор", async () => {
      const p = await pay();
      await expect(matchPaymentToOrders(t.db, t.users.owner, p, [])).rejects.toBeInstanceOf(
        ValidationError,
      );
      const cash = await bankOrder("shipped", { paymentKind: "cash" });
      await expect(matchPaymentToOrders(t.db, t.users.owner, p, [cash])).rejects.toThrow(/готівк/);
      await expect(
        matchPaymentToOrders(t.db, t.users.owner, p, ["00000000-0000-4000-8000-000000000000"]),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("пояснення в черзі", () => {
    it("названі замовлення: придатні з залишком, проблемні з причиною; список замовлень клієнта", async () => {
      const ok = await bankOrder();
      const cash = await bankOrder("shipped", { paymentKind: "cash" });
      const okN = (await row(ok)).number;
      const cashN = (await row(cash)).number;
      await pay({ amount: "1000.00", comment: `замовлення №${okN}, ${cashN}, 987654` });
      const [item] = await listQueue(t.db, t.users.owner);
      const byNumber = new Map(item!.named.map((n) => [n.number, n]));
      expect(byNumber.get(okN!)).toMatchObject({ problem: null, remaining: "2250.00" });
      expect(byNumber.get(cashN!)!.problem).toMatch(/готівк/);
      expect(byNumber.get(987654)).toMatchObject({ orderId: null, problem: "не знайдено." });
      expect(item!.clientOrders.map((o) => o.orderId)).toEqual([ok]);
    });
  });

  describe("реквізити (D197)", () => {
    it("зберігаються в налаштуваннях, порожній текст прибирає, довгий відхиляється", async () => {
      expect(await getRequisites(t.db, t.users.owner)).toBeNull();
      await setRequisites(t.db, t.users.accountant, "  Отримувач: ФОП Тест\nРахунок: UA00  ");
      expect(await getRequisites(t.db, t.users.owner)).toBe("Отримувач: ФОП Тест\nРахунок: UA00");
      await setRequisites(t.db, t.users.owner, "");
      expect(await getRequisites(t.db, t.users.owner)).toBeNull();
      await expect(setRequisites(t.db, t.users.owner, "x".repeat(1001))).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(setRequisites(t.db, t.users.manager, "x")).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });
});
