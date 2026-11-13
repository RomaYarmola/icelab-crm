import { describe, expect, it } from "vitest";
import {
  cashAmountProblem,
  cashReceivingProblem,
  canSettleByCash,
  parseCashAmount,
  summarizeCash,
  toKopecks,
} from "@/server/cash-rules";

describe("готівка: правила (D67)", () => {
  describe("сума з форми", () => {
    it.each([
      ["450", 45000],
      ["450,5", 45050],
      ["450.50", 45050],
      [" 1 200 ", 120000],
      ["0,01", 1],
      [450, 45000],
    ])("«%s» дає %i копійок", (input, kopecks) => {
      expect(parseCashAmount(input)).toEqual({ kopecks });
    });

    it.each([
      ["", "Вкажіть суму."],
      ["abc", "числом"],
      ["0", "більшою за нуль"],
      ["-5", "більшою за нуль"],
      ["10,555", "двох знаків"],
      ["100000000", "занадто велика"],
    ])("«%s» відхиляється", (input, part) => {
      const result = parseCashAmount(input);
      expect("error" in result && result.error).toContain(part);
    });

    it("копійки без помилок округлення: 0,1 + 0,2 дорівнює 0,3", () => {
      expect(toKopecks("0.10") + toKopecks("0.20")).toBe(toKopecks("0.30"));
    });
  });

  describe("підсумок по замовленню", () => {
    const entry = (amount: string, reversed = false) => ({ amount, reversed });

    it("нічого не прийнято: залишок дорівнює сумі, не сплачено, не частково", () => {
      expect(summarizeCash("2400.00", [])).toEqual({
        total: 240000,
        received: 0,
        remaining: 240000,
        paid: false,
        partial: false,
      });
    });

    it("частина прийнята: частково, лишилось різницю", () => {
      expect(summarizeCash("2400.00", [entry("1000.00")])).toMatchObject({
        received: 100000,
        remaining: 140000,
        paid: false,
        partial: true,
      });
    });

    it("кілька записів додаються", () => {
      const result = summarizeCash("900", [entry("300"), entry("300.50"), entry("299.50")]);
      expect(result).toMatchObject({ received: 90000, remaining: 0, paid: true, partial: false });
    });

    it("сторновані записи не рахуються (D69)", () => {
      const result = summarizeCash("900", [entry("900", true), entry("400")]);
      expect(result).toMatchObject({ received: 40000, remaining: 50000, paid: false });
    });

    it("допуск: не вистачає 5 грн вважається сплаченим, 5,01 ще ні", () => {
      expect(summarizeCash("900", [entry("895")]).paid).toBe(true);
      expect(summarizeCash("900", [entry("894.99")]).paid).toBe(false);
      expect(summarizeCash("900", [entry("895")]).remaining).toBe(500);
    });

    it("допуск береться з налаштувань", () => {
      expect(summarizeCash("900", [entry("890")], 10).paid).toBe(true);
      expect(summarizeCash("900", [entry("890")], 0).paid).toBe(false);
      expect(summarizeCash("900", [entry("899.99")], 0).paid).toBe(false);
    });

    it("порожні записи не роблять замовлення сплаченим, навіть коли сума менша за допуск", () => {
      expect(summarizeCash("3", []).paid).toBe(false);
      expect(summarizeCash("0", []).paid).toBe(false);
    });
  });

  describe("що можна записувати", () => {
    const base = { status: "shipped", paymentKind: "cash" } as const;

    it("готівку приймають по підтвердженому замовленню з готівковою оплатою", () => {
      for (const status of ["confirmed", "in_production", "packed", "shipped"] as const) {
        expect(cashReceivingProblem({ ...base, status })).toBeNull();
      }
    });

    it("чернетка, скасоване й оплачене готівки не приймають", () => {
      expect(cashReceivingProblem({ ...base, status: "draft" })).toContain("підтвердіть");
      expect(cashReceivingProblem({ ...base, status: "cancelled" })).toContain("скасоване");
      expect(cashReceivingProblem({ ...base, status: "paid" })).toContain("вже оплачене");
      expect(cashReceivingProblem({ ...base, status: "closed" })).toContain("вже оплачене");
    });

    it("замовлення не з готівкою (ФОП, ТОВ, невідомо) готівки не приймає", () => {
      for (const paymentKind of ["fop", "company", "unknown"] as const) {
        expect(cashReceivingProblem({ ...base, paymentKind })).toContain("не з готівковою");
      }
    });
  });

  describe("переплату не приймаємо", () => {
    it("сума в межах залишку проходить, більша відхиляється з підказкою", () => {
      expect(cashAmountProblem(45000, 45000)).toBeNull();
      expect(cashAmountProblem(100, 45000)).toBeNull();
      expect(cashAmountProblem(45001, 45000)).toMatch(/лишилось 450\s₴/);
    });

    it("коли все вже прийнято, нова сума відхиляється", () => {
      expect(cashAmountProblem(100, 0)).toContain("все вже прийнято");
    });
  });

  describe("коли ставимо «Оплачено» (ТЗ 5.1)", () => {
    it("з «Відправлено» завжди; із «Запаковано» лише для самовивозу", () => {
      expect(canSettleByCash("shipped", "np")).toBe(true);
      expect(canSettleByCash("shipped", "pickup")).toBe(true);
      expect(canSettleByCash("packed", "pickup")).toBe(true);
      expect(canSettleByCash("packed", "np")).toBe(false);
      expect(canSettleByCash("packed", "our_delivery")).toBe(false);
      expect(canSettleByCash("in_production", "pickup")).toBe(false);
      expect(canSettleByCash("confirmed", "pickup")).toBe(false);
    });
  });
});
