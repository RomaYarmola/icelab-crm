import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bankAccounts, orders, paymentMatches, payments, settings } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import {
  ignorePayment,
  matchNewPayments,
  matchPaymentManually,
  restorePayment,
  tryAutoMatch,
  unmatchPayment,
} from "@/server/payments";
import { USER_ROLES } from "@/server/permissions";
import { ValidationError } from "@/server/errors";
import { CASH_TOLERANCE_KEY } from "@/server/cash-settlement";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("платежі: автозіставлення, ручне, ігнорування, скасування (B13, D188–D190)", () => {
  let t: OrderTestContext;
  let accountId: string;
  let seq = 0;

  beforeAll(async () => {
    t = await setupOrderTests();
    const [account] = await t.db
      .insert(bankAccounts)
      .values({ accountId: "fop-test", label: "ФОП" })
      .returning({ id: bankAccounts.id });
    accountId = account!.id;
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(paymentMatches);
    await t.db.delete(payments);
    // Замовлення з минулих тестів не повинні потрапляти в кандидати.
    await t.db.update(orders).set({ deletedAt: new Date() });
    await t.db.delete(settings).where(eq(settings.key, CASH_TOLERANCE_KEY));
  });

  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const pay = async (over: Partial<typeof payments.$inferInsert> = {}) => {
    seq += 1;
    const [created] = await t.db
      .insert(payments)
      .values({
        bankAccountId: accountId,
        externalId: `op-${seq}`,
        occurredAt: new Date(),
        amount: "2250.00",
        counterName: "Кафе Тест",
        ...over,
      })
      .returning({ id: payments.id });
    return created!.id;
  };
  const matchesOf = (paymentId: string) =>
    t.db.select().from(paymentMatches).where(eq(paymentMatches.paymentId, paymentId));
  const statusOf = async (id: string) =>
    (await t.db.select().from(payments).where(eq(payments.id, id)))[0]!.matchStatus;

  /** Замовлення на 30 кг по 75 ₴ (2 250 ₴) з оплатою ФОП, доведене до статусу. */
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

  describe("автоматично", () => {
    it("номер у коментарі й точна сума: платіж «само», замовлення оплачене й закрите", async () => {
      const id = await bankOrder();
      const number = (await row(id)).number;
      const p = await pay({
        comment: `Оплата за замовлення №${number}`,
        counterName: "Хтось інший",
      });
      expect(await tryAutoMatch(t.db, p)).toMatchObject({ matched: true, rule: "comment_number" });
      expect(await statusOf(p)).toBe("auto");
      expect((await matchesOf(p))[0]).toMatchObject({
        amount: "2250.00",
        matchedBy: null,
        rule: "comment_number",
      });
      expect(await row(id)).toMatchObject({ status: "closed" });
    });

    it("платник і сума без номера: правило «сума, дата, платник»", async () => {
      const id = await bankOrder();
      const p = await pay();
      expect(await tryAutoMatch(t.db, p)).toMatchObject({
        matched: true,
        rule: "amount_date_name",
      });
      expect((await row(id)).paidAt).toBeInstanceOf(Date);
    });

    it("замовлення ще не відправлене: платіж прив'язано, «Оплачено» чекає відправки", async () => {
      const id = await bankOrder("confirmed");
      const p = await pay();
      expect((await tryAutoMatch(t.db, p)).matched).toBe(true);
      expect(await row(id)).toMatchObject({ status: "confirmed" });
      await transitionOrder(t.db, t.users.location_lead, id, "in_production");
      await transitionOrder(t.db, t.users.location_lead, id, "packed");
      await transitionOrder(t.db, t.users.owner, id, "shipped");
      expect(await row(id)).toMatchObject({ status: "closed" });
    });

    it("сума інша, платник чужий, два однакових замовлення: платіж лишається в черзі", async () => {
      await bankOrder();
      const wrongAmount = await pay({ amount: "1000.00" });
      const stranger = await pay({ counterName: "Інше кафе" });
      expect((await tryAutoMatch(t.db, wrongAmount)).matched).toBe(false);
      expect((await tryAutoMatch(t.db, stranger)).matched).toBe(false);
      await bankOrder();
      const ambiguous = await pay();
      expect((await tryAutoMatch(t.db, ambiguous)).matched).toBe(false);
      expect(await statusOf(ambiguous)).toBe("unmatched");
    });

    it("готівкове й невизначене замовлення платежем не закривається", async () => {
      const cash = await bankOrder("shipped", { paymentKind: "cash" });
      const unknown = await bankOrder("shipped", { paymentKind: "unknown" });
      const p = await pay({ comment: `замовлення №${(await row(cash)).number}` });
      const q = await pay({ comment: `замовлення №${(await row(unknown)).number}` });
      expect((await tryAutoMatch(t.db, p)).matched).toBe(false);
      expect((await tryAutoMatch(t.db, q)).matched).toBe(false);
      expect((await row(cash)).status).toBe("shipped");
    });

    it("один платіж не закриє два замовлення; повторний запуск нічого не дублює", async () => {
      const first = await bankOrder();
      await bankOrder("confirmed", { kgSold: 10 });
      const p = await pay({ comment: `№${(await row(first)).number}` });
      await matchNewPayments(t.db);
      await matchNewPayments(t.db);
      expect(await matchesOf(p)).toHaveLength(1);
    });

    it("переплата понад допуск: у чергу; у межах допуску: оплачено, платіж розкладено", async () => {
      const id = await bankOrder();
      const over = await pay({ amount: "2260.00", comment: `№${(await row(id)).number}` });
      expect((await tryAutoMatch(t.db, over)).matched).toBe(false);
      await t.db.insert(settings).values({ key: CASH_TOLERANCE_KEY, value: 10 });
      expect((await tryAutoMatch(t.db, over)).matched).toBe(true);
      expect(await statusOf(over)).toBe("auto");
      expect((await matchesOf(over))[0]!.amount).toBe("2250.00");
    });

    it("matchNewPayments рахує перевірені й зіставлені", async () => {
      await bankOrder();
      await pay();
      await pay({ amount: "1.00", counterName: "Невідомий" });
      expect(await matchNewPayments(t.db)).toEqual({ checked: 2, matched: 1 });
    });
  });

  describe("вручну", () => {
    it("розкласти платіж на два замовлення: статус «вручну», обидва оплачені", async () => {
      const a = await bankOrder("shipped", { kgSold: 10 });
      const b = await bankOrder("shipped", { kgSold: 20 });
      const p = await pay({ amount: "2250.00", counterName: "Інша назва" });
      const result = await matchPaymentManually(t.db, t.users.accountant, p, [
        { orderId: a, amount: "750" },
        { orderId: b, amount: "1500" },
      ]);
      expect(result).toEqual({ status: "manual", remainingKopecks: 0 });
      expect((await matchesOf(p)).every((m) => m.matchedBy === t.users.accountant.id)).toBe(true);
      expect((await row(a)).status).toBe("closed");
      expect((await row(b)).status).toBe("closed");
    });

    it("часткова сума: платіж лишається в черзі з залишком, замовлення не оплачене", async () => {
      const id = await bankOrder();
      const p = await pay({ amount: "1000.00" });
      expect(
        await matchPaymentManually(t.db, t.users.owner, p, [{ orderId: id, amount: "1000" }]),
      ).toMatchObject({
        status: "manual",
      });
      expect((await row(id)).status).toBe("shipped");
      const rest = await pay({ amount: "1250.00" });
      await matchPaymentManually(t.db, t.users.owner, rest, [{ orderId: id, amount: "1250" }]);
      expect((await row(id)).status).toBe("closed");
    });

    it("переплата понад залишок: платіж лишається в черзі залишком", async () => {
      const id = await bankOrder();
      const p = await pay({ amount: "3000.00" });
      const result = await matchPaymentManually(t.db, t.users.owner, p, [
        { orderId: id, amount: "2250" },
      ]);
      expect(result).toEqual({ status: "unmatched", remainingKopecks: 75000 });
      expect(await statusOf(p)).toBe("unmatched");
    });

    it("помилки: сума більша за платіж чи залишок, готівка, невизначена оплата, повтор", async () => {
      const id = await bankOrder();
      const p = await pay({ amount: "1000.00" });
      const fail = (orderId: string, amount: string, paymentId = p) =>
        matchPaymentManually(t.db, t.users.owner, paymentId, [{ orderId, amount }]);
      await expect(fail(id, "1000.01")).rejects.toBeInstanceOf(ValidationError);
      await expect(fail(id, "abc")).rejects.toBeInstanceOf(ValidationError);
      const big = await pay({ amount: "5000.00" });
      await expect(fail(id, "2300", big)).rejects.toThrow(/залишок/);
      const cash = await bankOrder("shipped", { paymentKind: "cash" });
      await expect(fail(cash, "100")).rejects.toThrow(/готівков/);
      const unknown = await bankOrder("shipped", { paymentKind: "unknown" });
      await expect(fail(unknown, "100")).rejects.toThrow(/спосіб оплати/);
      await fail(id, "500");
      await expect(fail(id, "100")).rejects.toThrow(/уже прив'язано/);
      await expect(matchPaymentManually(t.db, t.users.owner, p, [])).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("права: зіставляють лише власник і бухгалтер", async () => {
      for (const role of USER_ROLES) {
        const id = await bankOrder();
        const p = await pay();
        const attempt = matchPaymentManually(t.db, t.users[role], p, [
          { orderId: id, amount: "1" },
        ]);
        if (role === "owner" || role === "accountant") {
          await expect(attempt, role).resolves.toBeTruthy();
        } else {
          await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
    });
  });

  describe("ігнорувати, повернути, скасувати", () => {
    it("ігнорувати лише з причиною й лише незіставлене; повернути в чергу", async () => {
      const p = await pay();
      await expect(ignorePayment(t.db, t.users.accountant, p, "  ")).rejects.toBeInstanceOf(
        ValidationError,
      );
      await ignorePayment(t.db, t.users.accountant, p, "Переказ між своїми рахунками");
      expect(await statusOf(p)).toBe("ignored");
      expect((await tryAutoMatch(t.db, p)).matched).toBe(false);
      await expect(ignorePayment(t.db, t.users.owner, p, "ще раз")).rejects.toThrow(
        /уже ігноровано/,
      );
      await restorePayment(t.db, t.users.owner, p);
      expect(await statusOf(p)).toBe("unmatched");

      const id = await bankOrder();
      const matched = await pay({ amount: "100.00" });
      await matchPaymentManually(t.db, t.users.owner, matched, [{ orderId: id, amount: "100" }]);
      await expect(ignorePayment(t.db, t.users.owner, matched, "хибно")).rejects.toThrow(
        /зіставлено/,
      );
    });

    it("скасувати зіставлення може лише власник, і не для оплаченого замовлення", async () => {
      const id = await bankOrder();
      const partial = await pay({ amount: "1000.00" });
      await matchPaymentManually(t.db, t.users.owner, partial, [{ orderId: id, amount: "1000" }]);
      await expect(
        unmatchPayment(t.db, t.users.accountant, partial, "помилка"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(unmatchPayment(t.db, t.users.owner, partial, "")).rejects.toBeInstanceOf(
        ValidationError,
      );
      await unmatchPayment(t.db, t.users.owner, partial, "Помилково прив'язали");
      expect(await matchesOf(partial)).toHaveLength(0);
      expect(await statusOf(partial)).toBe("unmatched");

      const full = await pay();
      await matchPaymentManually(t.db, t.users.owner, full, [{ orderId: id, amount: "2250" }]);
      await expect(unmatchPayment(t.db, t.users.owner, full, "помилка")).rejects.toThrow(
        /Оплачено/,
      );
    });
  });
});
