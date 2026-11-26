import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients } from "@/db/schema";
import { addCo2Receipt } from "@/server/finance/co2";
import {
  addCategory,
  closeMonth,
  getMonthPage,
  reopenMonth,
  saveLedgerEntries,
  setCommissionRate,
  setUsdRate,
  updateCategory,
} from "@/server/finance/month";
import { buildReport, commissionKopecks } from "@/server/finance/month-rules";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { shiftMonth } from "@/utils/month";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const MONTH = "2026-11";
const TODAY = "2026-12-05";

describe("правила підсумків місяця (B15)", () => {
  it("комісія: кг × ставка з округленням; без ставки нуль", () => {
    expect(commissionKopecks(1_500, 233)).toBe(350);
    expect(commissionKopecks(1_000, null)).toBe(0);
  });

  it("результат = доходи − CO2 − витрати − комісії, разом по всіх колонках", () => {
    const report = buildReport({
      month: MONTH,
      usdRate: null,
      columns: [
        {
          locationId: "a",
          name: "А",
          revenue: { ice: 1000, delivery: 100, boxes: 50, other: 10 },
          otherIncome: [{ label: "інше", kopecks: 40 }],
          co2: { orders: 300, writeoffs: 20, shortageGrams: 0 },
          expenses: [{ label: "оренда", kopecks: 200 }],
          commissions: [{ profileId: "m", name: "М", grams: 10_000, rateKopecks: 3 }],
        },
        {
          locationId: null,
          name: "Спільні",
          revenue: { ice: 0, delivery: 0, boxes: 0, other: 0 },
          otherIncome: [],
          co2: { orders: 0, writeoffs: 0, shortageGrams: 0 },
          expenses: [{ label: "бухгалтер", kopecks: 100 }],
          commissions: [],
        },
      ],
    });
    expect(report.columns[0]).toMatchObject({ income: 1200, costs: 550, result: 650 });
    expect(report.total).toEqual({ income: 1200, costs: 650, result: 550 });
  });

  it("сусідні місяці через рік", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("місяць фінрезультату: серверні функції", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
    await t.db
      .update(clients)
      .set({ managerId: t.users.manager.id })
      .where(eq(clients.id, t.client.id));
    await addCo2Receipt(
      t.db,
      t.users.owner,
      { locationId: t.location, receivedOn: "2026-11-01", kg: 1000, pricePerKg: 30 },
      TODAY,
    );
    const { id } = await t.create({
      kgSold: 30,
      kgToProduce: "33",
      deliveryMethod: "our_delivery",
      deliveryPrice: 300,
    });
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    await t.create({ kgSold: 100 });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const page = (month = MONTH) => getMonthPage(t.db, t.users.owner, { month, today: TODAY });
  const columnOf = async (month = MONTH) =>
    (await page(month)).report.columns.find((c) => c.locationId === t.location)!;
  const category = async (name: string) =>
    (await page()).categories.find((c) => c.name === name)!.id;

  it("бачить і змінює лише власник", async () => {
    for (const actor of [t.users.manager, t.users.accountant]) {
      await expect(getMonthPage(t.db, actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setUsdRate(t.db, actor, { month: MONTH, usdRate: 42 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(closeMonth(t.db, actor, { month: MONTH }, TODAY)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it("дохід за видами з замовлень без чернеток, CO2 і комісія менеджера клієнта", async () => {
    let column = await columnOf();
    expect(column.revenue).toEqual({ ice: 225_000, delivery: 30_000, boxes: 0, other: 0 });
    expect(column.commissions).toMatchObject([{ grams: 30_000, rateKopecks: null, kopecks: 0 }]);
    // 33 кг льоду × норма × 30 ₴; норми в тестовій базі ще немає.
    expect(column.co2.orders).toBe(0);

    await setCommissionRate(t.db, t.users.owner, {
      profileId: t.users.manager.id,
      month: "2026-10",
      ratePerKg: "2,5",
    });
    column = await columnOf();
    expect(column.commissions[0]).toMatchObject({ rateKopecks: 250, kopecks: 7_500 });
    // Ставка не діє на місяці до її початку.
    expect((await page("2026-09")).managers.find((m) => m.rate !== null)).toBeUndefined();
  });

  it("суми статей: зберігаються по містах і спільні, порожнє прибирає, «щомісячні» підставляються", async () => {
    const salary = await category("Зарплати й премії");
    const rent = await category("Оренда бочки");
    await saveLedgerEntries(t.db, t.users.owner, {
      month: "2026-10",
      locationId: t.location,
      amounts: [
        { categoryId: salary, amount: "5000" },
        { categoryId: rent, amount: "700" },
      ],
    });
    const scope = async () => (await page()).scopes.find((s) => s.locationId === t.location)!;
    const field = async (id: string) => (await scope()).fields.find((f) => f.categoryId === id)!;
    expect(await field(salary)).toMatchObject({ amount: null, suggestion: "5000.00" });
    expect(await field(rent)).toMatchObject({ amount: null, suggestion: null });

    await saveLedgerEntries(t.db, t.users.owner, {
      month: MONTH,
      locationId: null,
      amounts: [{ categoryId: rent, amount: "100,50" }],
    });
    let report = (await page()).report;
    expect(report.columns.at(-1)!.expenses).toEqual([{ label: "Оренда бочки", kopecks: 10_050 }]);
    await saveLedgerEntries(t.db, t.users.owner, {
      month: MONTH,
      locationId: null,
      amounts: [{ categoryId: rent, amount: "" }],
    });
    report = (await page()).report;
    expect(report.columns.at(-1)!.expenses).toEqual([]);
    await expect(
      saveLedgerEntries(t.db, t.users.owner, {
        month: MONTH,
        locationId: null,
        amounts: [{ categoryId: rent, amount: "-1" }],
      }),
    ).rejects.toThrow("від нуля");
  });

  it("статті: нова з'являється у формі, повтор назви відхиляється, вимкнена ховається", async () => {
    const input = { name: "Охорона", kind: "expense" as const, repeatsMonthly: false };
    await addCategory(t.db, t.users.owner, input);
    await expect(addCategory(t.db, t.users.owner, { ...input, name: "охорона" })).rejects.toThrow(
      "вже є",
    );
    const id = await category("Охорона");
    await updateCategory(t.db, t.users.owner, { id, repeatsMonthly: false, isActive: false });
    expect((await page()).scopes[0]!.fields.some((f) => f.categoryId === id)).toBe(false);
  });

  it("закриття: лише завершений місяць, із курсом і без непідтверджених сум; цифри фіксуються", async () => {
    await expect(closeMonth(t.db, t.users.owner, { month: "2026-12" }, TODAY)).rejects.toThrow(
      "ще не завершився",
    );
    await expect(closeMonth(t.db, t.users.owner, { month: MONTH }, TODAY)).rejects.toThrow(
      "минулого місяця",
    );
    const salary = await category("Зарплати й премії");
    await saveLedgerEntries(t.db, t.users.owner, {
      month: MONTH,
      locationId: t.location,
      amounts: [{ categoryId: salary, amount: "5000" }],
    });
    await expect(closeMonth(t.db, t.users.owner, { month: MONTH }, TODAY)).rejects.toThrow(
      "курс долара",
    );
    await setUsdRate(t.db, t.users.owner, { month: MONTH, usdRate: "41,5" });
    await closeMonth(t.db, t.users.owner, { month: MONTH }, TODAY);
    const before = (await page()).report;
    expect(before.usdRate).toBe(41.5);

    const { id } = await t.create({ kgSold: 10 });
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    await setCommissionRate(t.db, t.users.owner, {
      profileId: t.users.manager.id,
      month: "2026-10",
      ratePerKg: 9,
    }).catch(() => undefined);
    expect((await page()).report).toEqual(before);
    for (const attempt of [
      setUsdRate(t.db, t.users.owner, { month: MONTH, usdRate: 40 }),
      saveLedgerEntries(t.db, t.users.owner, { month: MONTH, locationId: null, amounts: [] }),
      closeMonth(t.db, t.users.owner, { month: MONTH }, TODAY),
    ]) {
      await expect(attempt).rejects.toThrow("Місяць закрито");
    }

    await reopenMonth(t.db, t.users.owner, { month: MONTH });
    expect((await columnOf()).revenue.ice).toBe(300_000);
    await expect(reopenMonth(t.db, t.users.owner, { month: MONTH })).rejects.toThrow("не закрито");
  });
});
