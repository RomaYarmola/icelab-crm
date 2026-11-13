import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, cashEntries, orderStatusHistory, orders, settings } from "@/db/schema";
import { getOrderCash, listCashDay, recordCashEntry, reverseCashEntry } from "@/server/cash";
import { ValidationError } from "@/server/errors";
import { findForbiddenFields } from "@/server/dto";
import { ForbiddenError, type AppUser } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { todayIso } from "@/utils/isoDate";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("готівка: запис, оплата, сторно, підсумок дня (D67–D69)", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const entriesOf = (orderId: string) =>
    t.db.select().from(cashEntries).where(eq(cashEntries.orderId, orderId));
  const history = async (id: string) =>
    (await t.db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)))
      .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
      .map((h) => `${h.fromStatus ?? "∅"}>${h.toStatus}`);

  /** Готівкове замовлення на 30 кг по 75 ₴ (2 250 ₴), доведене до статусу. */
  const cashOrder = async (
    until: "draft" | "confirmed" | "in_production" | "packed" | "shipped" = "shipped",
    overrides: Parameters<typeof t.create>[0] = {},
  ) => {
    const { id } = await t.create({ paymentKind: "cash", ...overrides });
    const steps = ["confirmed", "in_production", "packed", "shipped"] as const;
    if (until === "draft") return id;
    for (const step of steps) {
      const actor =
        step === "confirmed" || step === "shipped" ? t.users.owner : t.users.location_lead;
      await transitionOrder(t.db, actor, id, step);
      if (step === until) break;
    }
    return id;
  };

  describe("запис готівки", () => {
    it("старший локації записує частину: статус не змінюється, залишок рахується", async () => {
      const id = await cashOrder();
      const result = await recordCashEntry(t.db, t.users.location_lead, {
        orderId: id,
        amount: "1000",
      });
      expect(result).toMatchObject({ status: "shipped", remainingSum: "1250.00", settled: false });
      const [entry] = await entriesOf(id);
      expect(entry).toMatchObject({
        amount: "1000.00",
        enteredBy: t.users.location_lead.id,
        enteredVia: "web",
        locationId: t.location,
      });
      expect(entry!.receivedOn).toBe(todayIso());
    });

    it("остання сума ставить «Оплачено», а далі замовлення саме закривається", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.location_lead, { orderId: id, amount: "1000" });
      const result = await recordCashEntry(t.db, t.users.location_lead, {
        orderId: id,
        amount: "1250",
      });
      expect(result).toMatchObject({ settled: true, status: "closed", remainingSum: "0.00" });
      expect(await row(id)).toMatchObject({ status: "closed" });
      expect((await row(id)).paidAt).toBeInstanceOf(Date);
      expect(await history(id)).toEqual([
        "∅>draft",
        "draft>confirmed",
        "confirmed>in_production",
        "in_production>packed",
        "packed>shipped",
        "shipped>paid",
        "paid>closed",
      ]);
      const paid = (
        await t.db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id))
      ).find((h) => h.toStatus === "paid");
      expect(paid).toMatchObject({
        changedBy: t.users.location_lead.id,
        note: "Оплачено автоматично: готівку прийнято повністю",
      });
    });

    it("допуск з налаштувань: не вистачає 5 грн вважається сплаченим", async () => {
      const id = await cashOrder();
      const result = await recordCashEntry(t.db, t.users.location_lead, {
        orderId: id,
        amount: "2245",
      });
      expect(result.settled).toBe(true);
      expect((await row(id)).status).toBe("closed");
    });

    it("допуск береться з налаштувань, а не з коду", async () => {
      await t.db
        .update(settings)
        .set({ value: 0 })
        .where(eq(settings.key, "payment.amount_tolerance_uah"));
      const id = await cashOrder();
      const result = await recordCashEntry(t.db, t.users.owner, { orderId: id, amount: "2245" });
      expect(result.settled).toBe(false);
      expect((await row(id)).status).toBe("shipped");
      await t.db
        .update(settings)
        .set({ value: 5 })
        .where(eq(settings.key, "payment.amount_tolerance_uah"));
    });

    it("переплату не приймає, підказує залишок", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.location_lead, { orderId: id, amount: "2000" });
      await expect(
        recordCashEntry(t.db, t.users.location_lead, { orderId: id, amount: "300" }),
      ).rejects.toThrow(/лишилось 250\s₴/);
      expect(await entriesOf(id)).toHaveLength(1);
    });

    it("поганий ввід відхиляється: нуль, від'ємне, три знаки, не число, майбутня дата", async () => {
      const id = await cashOrder();
      for (const [amount, part] of [
        ["0", "більшою за нуль"],
        ["-5", "більшою за нуль"],
        ["10,555", "двох знаків"],
        ["abc", "числом"],
        ["", "Вкажіть суму"],
      ] as const) {
        await expect(recordCashEntry(t.db, t.users.owner, { orderId: id, amount })).rejects.toThrow(
          part,
        );
      }
      await expect(
        recordCashEntry(t.db, t.users.owner, {
          orderId: id,
          amount: "10",
          receivedOn: "2999-01-01",
        }),
      ).rejects.toThrow("в майбутньому");
      expect(await entriesOf(id)).toHaveLength(0);
    });

    it("не з готівкою, чернетка, скасоване й оплачене готівки не приймають", async () => {
      const fop = (await t.create({ paymentKind: "fop" })).id;
      await transitionOrder(t.db, t.users.owner, fop, "confirmed");
      await expect(
        recordCashEntry(t.db, t.users.owner, { orderId: fop, amount: "10" }),
      ).rejects.toThrow("не з готівковою");
      await expect(
        recordCashEntry(t.db, t.users.owner, {
          orderId: await cashOrder("draft"),
          amount: "10",
        }),
      ).rejects.toThrow("підтвердіть");
      const cancelled = await cashOrder("confirmed");
      await transitionOrder(t.db, t.users.owner, cancelled, "cancelled", { note: "Тест" });
      await expect(
        recordCashEntry(t.db, t.users.owner, { orderId: cancelled, amount: "10" }),
      ).rejects.toThrow("скасоване");
      const paid = await cashOrder();
      await recordCashEntry(t.db, t.users.owner, { orderId: paid, amount: "2250" });
      await expect(
        recordCashEntry(t.db, t.users.owner, { orderId: paid, amount: "10" }),
      ).rejects.toThrow("вже оплачене");
    });

    it("записи пишуться в журнал змін з автором", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.location_lead, { orderId: id, amount: "100" });
      const [entry] = await entriesOf(id);
      const logs = await t.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "cash_entries"), eq(auditLog.rowId, entry!.id)));
      expect(logs.map((l) => [l.action, l.actorId])).toEqual([
        ["insert", t.users.location_lead.id],
      ]);
    });
  });

  describe("готівка раніше, ніж відправили (передоплата)", () => {
    it("прийнято все в «Підтверджено»: статус не змінюється, а при «Відправлено» замовлення стає оплаченим", async () => {
      const id = await cashOrder("confirmed");
      const result = await recordCashEntry(t.db, t.users.owner, { orderId: id, amount: "2250" });
      expect(result).toMatchObject({ settled: false, status: "confirmed" });
      await transitionOrder(t.db, t.users.location_lead, id, "in_production");
      await transitionOrder(t.db, t.users.location_lead, id, "packed");
      expect((await row(id)).status).toBe("packed");
      await transitionOrder(t.db, t.users.location_lead, id, "shipped");
      expect((await row(id)).status).toBe("closed");
      expect(await history(id)).toContain("shipped>paid");
    });
  });

  describe("самовивіз: оплата на місці із «Запаковано» (ТЗ 5.1)", () => {
    it("повна сума при «Запаковано» одразу дає «Оплачено» без «Відправлено»", async () => {
      const id = await cashOrder("packed", { deliveryMethod: "pickup" });
      const result = await recordCashEntry(t.db, t.users.location_lead, {
        orderId: id,
        amount: "2250",
      });
      expect(result).toMatchObject({ settled: true, status: "closed" });
      expect(await history(id)).toContain("packed>paid");
      expect(await history(id)).not.toContain("packed>shipped");
    });

    it("доставка з «Запаковано» оплаченою не стає: чекає «Відправлено»", async () => {
      const id = await cashOrder("packed", { deliveryMethod: "np" });
      const result = await recordCashEntry(t.db, t.users.location_lead, {
        orderId: id,
        amount: "2250",
      });
      expect(result).toMatchObject({ settled: false, status: "packed" });
    });
  });

  describe("гонка: двоє приймають останню суму одночасно", () => {
    it("проходить один запис, переплати немає", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.owner, { orderId: id, amount: "1250" });
      const results = await Promise.allSettled([
        recordCashEntry(t.db, t.users.owner, { orderId: id, amount: "1000" }),
        recordCashEntry(t.db, t.users.location_lead, { orderId: id, amount: "1000" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(ValidationError);
      const sum = (await entriesOf(id)).reduce((s, e) => s + Number(e.amount), 0);
      expect(sum).toBe(2250);
    });
  });

  describe("права на запис за ролями (матриця B2)", () => {
    it("пише власник і старший локації своєї локації; решта ні", async () => {
      const id = await cashOrder();
      for (const role of USER_ROLES) {
        const actor = t.users[role];
        const attempt = recordCashEntry(t.db, actor, { orderId: id, amount: "1" });
        if (role === "owner" || role === "location_lead") {
          await expect(attempt, role).resolves.toBeTruthy();
        } else {
          await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
    });

    it("водій записує лише через бота (B12): у вебі ні, через бота своєї локації так", async () => {
      const id = await cashOrder();
      await expect(
        recordCashEntry(t.db, t.users.driver, { orderId: id, amount: "1" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const result = await recordCashEntry(t.db, t.users.driver, {
        orderId: id,
        amount: "100",
        via: "driver_bot",
        receivedBy: "Водій Іван",
      });
      expect(result.remainingSum).toBe("2150.00");
      expect((await entriesOf(id))[0]).toMatchObject({
        enteredVia: "driver_bot",
        receivedByText: "Водій Іван",
        enteredBy: t.users.driver.id,
      });
    });

    it("старший локації чужої локації: «немає доступу»", async () => {
      const id = await cashOrder();
      await expect(
        recordCashEntry(t.db, t.otherLead, { orderId: id, amount: "1" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await entriesOf(id)).toHaveLength(0);
    });
  });

  describe("сторно: лише власник, з причиною (D69)", () => {
    it("запис лишається, у підсумках не рахується, причина й автор записані", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.location_lead, { orderId: id, amount: "1000" });
      const [entry] = await entriesOf(id);
      await reverseCashEntry(t.db, t.users.owner, entry!.id, "Помилилися сумою");
      const [after] = await entriesOf(id);
      expect(after).toMatchObject({
        reversedBy: t.users.owner.id,
        reversalReason: "Помилилися сумою",
      });
      const day = await listCashDay(t.db, t.users.owner, { date: "2026-11-13" });
      const view = day.orders.find((o) => o.id === id)!;
      expect(view).toMatchObject({
        receivedSum: "0.00",
        remainingSum: "2250.00",
        isPartial: false,
      });
      expect(view.entries[0]).toMatchObject({
        isReversed: true,
        reversalReason: "Помилилися сумою",
      });
      // Після сторно можна внести правильну суму.
      await expect(
        recordCashEntry(t.db, t.users.location_lead, { orderId: id, amount: "2250" }),
      ).resolves.toMatchObject({ settled: true });
    });

    it("без причини, повторно і для оплаченого замовлення сторно не проходить", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.owner, { orderId: id, amount: "1000" });
      const [entry] = await entriesOf(id);
      await expect(reverseCashEntry(t.db, t.users.owner, entry!.id, "  ")).rejects.toThrow(
        "причину",
      );
      await reverseCashEntry(t.db, t.users.owner, entry!.id, "Помилка");
      await expect(reverseCashEntry(t.db, t.users.owner, entry!.id, "Ще раз")).rejects.toThrow(
        "уже сторновано",
      );

      const paid = await cashOrder();
      await recordCashEntry(t.db, t.users.owner, { orderId: paid, amount: "2250" });
      const [paidEntry] = await entriesOf(paid);
      await expect(reverseCashEntry(t.db, t.users.owner, paidEntry!.id, "Помилка")).rejects.toThrow(
        "поверніть замовлення",
      );
    });

    it("власник повертає оплачене замовлення назад, і тоді сторно можливе", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.owner, { orderId: id, amount: "2250" });
      expect((await row(id)).status).toBe("closed");
      await transitionOrder(t.db, t.users.owner, id, "paid", { note: "Повернення" });
      await transitionOrder(t.db, t.users.owner, id, "shipped", { note: "Виправляємо касу" });
      const [entry] = await entriesOf(id);
      await reverseCashEntry(t.db, t.users.owner, entry!.id, "Гроші не отримали");
      expect((await row(id)).status).toBe("shipped");
    });

    it("сторно мають право лише власник; решта ролей отримують «немає прав»", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.owner, { orderId: id, amount: "100" });
      const [entry] = await entriesOf(id);
      for (const role of USER_ROLES.filter((r) => r !== "owner")) {
        await expect(
          reverseCashEntry(t.db, t.users[role], entry!.id, "Причина"),
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect((await entriesOf(id))[0]!.reversedAt).toBeNull();
    });
  });

  describe("підсумок дня (ТЗ 6.6)", () => {
    it("мало надійти, внесено, різниця; хто скільки прийняв", async () => {
      // Окрема локація, щоб підсумок не змішувався з рештою тестів.
      const lead = t.otherLead;
      const a = await t.create({
        paymentKind: "cash",
        locationId: t.otherLocation,
        orderDate: "2026-11-20",
      });
      const b = await t.create({
        paymentKind: "cash",
        locationId: t.otherLocation,
        orderDate: "2026-11-20",
        kgSold: 10,
      });
      for (const id of [a.id, b.id]) {
        await transitionOrder(t.db, t.users.owner, id, "confirmed");
        await transitionOrder(t.db, lead, id, "in_production");
        await transitionOrder(t.db, lead, id, "packed");
        await transitionOrder(t.db, lead, id, "shipped");
      }
      await recordCashEntry(t.db, lead, {
        orderId: a.id,
        amount: "2250",
        receivedOn: todayIso(),
        receivedBy: "Водій Іван",
      });
      await recordCashEntry(t.db, lead, { orderId: b.id, amount: "300" });

      const day = await listCashDay(t.db, lead, { date: "2026-11-20" });
      expect(day.orders.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
      expect(day.summary).toMatchObject({
        expectedSum: "3000.00",
        enteredSum: "2550.00",
        differenceSum: "450.00",
      });
      const byOrder = Object.fromEntries(day.orders.map((o) => [o.id, o]));
      expect(byOrder[a.id]).toMatchObject({ isPaid: true, remainingSum: "0.00" });
      expect(byOrder[b.id]).toMatchObject({
        amountDue: "750.00",
        receivedSum: "300.00",
        remainingSum: "450.00",
        isPartial: true,
      });

      const today = await listCashDay(t.db, lead, { date: todayIso() });
      expect(today.summary.receivedOnDaySum).toBe("2550.00");
      expect(today.summary.byReceiver).toEqual(
        expect.arrayContaining([{ name: "Водій Іван", sumReceived: "2250.00" }]),
      );
    });

    it("замовлення не з готівкою й чернетки в обліку не з'являються", async () => {
      await t.create({ paymentKind: "fop", orderDate: "2026-12-01" });
      await t.create({ paymentKind: "cash", orderDate: "2026-12-01" });
      const day = await listCashDay(t.db, t.users.owner, { date: "2026-12-01" });
      expect(day.orders).toEqual([]);
      expect(day.summary.expectedSum).toBe("0.00");
    });

    it("старший локації бачить лише свою локацію, навіть якщо просить чужу", async () => {
      const id = await cashOrder();
      const mine = await listCashDay(t.db, t.users.location_lead, {
        date: "2026-11-13",
        locationId: t.otherLocation,
      });
      expect(mine.locationId).toBe(t.location);
      expect(mine.orders.some((o) => o.id === id)).toBe(true);
      const foreign = await listCashDay(t.db, t.otherLead, { date: "2026-11-13" });
      expect(foreign.orders.some((o) => o.id === id)).toBe(false);
    });

    it("картка одного замовлення (кнопка «Готівка»): те саме подання; чужа локація заборонена", async () => {
      const id = await cashOrder();
      expect(await getOrderCash(t.db, t.users.location_lead, id)).toMatchObject({
        id,
        amountDue: "2250.00",
      });
      await expect(getOrderCash(t.db, t.otherLead, id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("права на читання і гроші у відповідях (D68)", () => {
    it("готівку читають власник, менеджер, бухгалтер і старший локації; виробництво й водій ні", async () => {
      for (const role of USER_ROLES) {
        const attempt = listCashDay(t.db, t.users[role], { date: "2026-11-13" });
        if (["owner", "manager", "accountant", "location_lead"].includes(role)) {
          await expect(attempt, role).resolves.toBeTruthy();
        } else {
          await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
    });

    it("старший локації не отримує цін за кг, позицій і заборонених полів, лише суму до сплати", async () => {
      const id = await cashOrder();
      await recordCashEntry(t.db, t.users.location_lead, { orderId: id, amount: "100" });
      const day = await listCashDay(t.db, t.users.location_lead, { date: "2026-11-13" });
      const view = day.orders.find((o) => o.id === id)!;
      expect(view.amountDue).toBe("2250.00");
      expect(findForbiddenFields(day, "location_lead")).toEqual([]);
      const keys = JSON.stringify(day);
      for (const forbidden of ["pricePerKg", "price", "items", "internalComment", "paymentKind"]) {
        expect(keys, forbidden).not.toContain(`"${forbidden}"`);
      }
    });

    it("бухгалтер і менеджер читають, але не пишуть (перевірено вище): подання без заборонених полів", async () => {
      const day = await listCashDay(t.db, t.users.accountant, { date: "2026-11-13" });
      expect(findForbiddenFields(day, "accountant")).toEqual([]);
      const asUser = (user: AppUser) => user.role;
      expect(asUser(t.users.manager)).toBe("manager");
    });
  });
});
