import { describe, expect, it } from "vitest";
import {
  amountFitsRemaining,
  decideAutoMatch,
  extractOrderNumbers,
  isFullyAllocated,
  namesMatch,
  normalizeName,
  type MatchOrder,
  type MatchPayment,
} from "@/server/payment-rules";

const PAID_AT = new Date("2026-11-20T10:00:00Z");
const payment = (over: Partial<MatchPayment> = {}): MatchPayment => ({
  amountKopecks: 225000,
  occurredAt: PAID_AT,
  comment: null,
  description: null,
  counterName: null,
  ...over,
});
const order = (over: Partial<MatchOrder> = {}): MatchOrder => ({
  id: "o1",
  number: 1340,
  clientId: "c1",
  clientName: "ТОВ «Кафе Тест»",
  remainingKopecks: 225000,
  orderDate: "2026-11-18",
  ...over,
});

describe("правила зіставлення платежів (B13, D188)", () => {
  describe("номер замовлення в тексті", () => {
    it("бере лише числа з позначкою", () => {
      expect(extractOrderNumbers("Оплата за замовлення №1340")).toEqual([1340]);
      expect(extractOrderNumbers("замовлення 1340, заказ 1341")).toEqual([1340, 1341]);
      expect(extractOrderNumbers("#77")).toEqual([77]);
      expect(extractOrderNumbers("За лід 1340 кг")).toEqual([]);
      expect(extractOrderNumbers(null, undefined, "")).toEqual([]);
    });
    it("об'єднує коментар і опис, дубль не рахує двічі", () => {
      expect(extractOrderNumbers("№5", "замовлення 5")).toEqual([5]);
    });
  });

  describe("назва платника", () => {
    it("без форми власності, лапок і регістру", () => {
      expect(normalizeName("Від: ТОВ «Кафе  Тест»")).toBe("кафе тест");
      expect(normalizeName("ФОП Іванов І.І.")).toBe("іванов і і");
    });
    it("збігається, коли одна назва входить в іншу; короткі назви не рахуємо", () => {
      expect(namesMatch("КАФЕ ТЕСТ", "ТОВ «Кафе Тест»")).toBe(true);
      expect(namesMatch("Кафе Тест Київ", "Кафе Тест")).toBe(true);
      expect(namesMatch("Інше кафе", "Кафе Тест")).toBe(false);
      expect(namesMatch("ТОВ", "ТОВ")).toBe(false);
      expect(namesMatch(null, "Кафе Тест")).toBe(false);
    });
  });

  describe("сума й допуск", () => {
    it("межі допуску", () => {
      expect(amountFitsRemaining(1000, 1000, 0)).toBe(true);
      expect(amountFitsRemaining(999, 1000, 0)).toBe(false);
      expect(amountFitsRemaining(1500, 1000, 500)).toBe(true);
      expect(amountFitsRemaining(1501, 1000, 500)).toBe(false);
    });
    it("розкладено повністю з допуском", () => {
      expect(isFullyAllocated(995, 1000, 5)).toBe(true);
      expect(isFullyAllocated(994, 1000, 5)).toBe(false);
    });
  });

  describe("рішення", () => {
    it("правило 1: номер у коментарі й сума збігаються", () => {
      expect(decideAutoMatch(payment({ comment: "Замовлення 1340" }), [order()], 0)).toEqual({
        orderId: "o1",
        appliedKopecks: 225000,
        rule: "comment_number",
      });
    });
    it("правило 1 не спрацьовує: інша сума, невідомий номер, два номери", () => {
      const o = [order()];
      expect(
        decideAutoMatch(payment({ comment: "замовлення 1340", amountKopecks: 100000 }), o, 0),
      ).toBeNull();
      expect(decideAutoMatch(payment({ comment: "замовлення 999" }), o, 0)).toBeNull();
      expect(decideAutoMatch(payment({ comment: "замовлення 1340 і 1341" }), o, 0)).toBeNull();
    });
    it("номер у коментарі важливіший за платника: невірна сума не підміняється іншим правилом", () => {
      const result = decideAutoMatch(
        payment({ comment: "замовлення 999", counterName: "Кафе Тест" }),
        [order()],
        0,
      );
      expect(result).toBeNull();
    });
    it("з допуском на пів гривні платіж трохи більший за залишок: на замовлення йде залишок", () => {
      const result = decideAutoMatch(
        payment({ comment: "№1340", amountKopecks: 225300 }),
        [order()],
        500,
      );
      expect(result).toMatchObject({ appliedKopecks: 225000 });
    });
    it("правило 2: платник збігається, сума точна, замовлення одне", () => {
      expect(decideAutoMatch(payment({ counterName: "Кафе Тест" }), [order()], 0)).toEqual({
        orderId: "o1",
        appliedKopecks: 225000,
        rule: "amount_date_name",
      });
    });
    it("правило 2 не спрацьовує: чужий платник, два однакових замовлення, замовлення поза вікном", () => {
      expect(decideAutoMatch(payment({ counterName: "Інше кафе" }), [order()], 0)).toBeNull();
      expect(
        decideAutoMatch(
          payment({ counterName: "Кафе Тест" }),
          [order(), order({ id: "o2", number: 1341 })],
          0,
        ),
      ).toBeNull();
      expect(
        decideAutoMatch(
          payment({ counterName: "Кафе Тест" }),
          [order({ orderDate: "2026-09-01" })],
          0,
        ),
      ).toBeNull();
      expect(
        decideAutoMatch(
          payment({ counterName: "Кафе Тест" }),
          [order({ orderDate: "2026-12-30" })],
          0,
        ),
      ).toBeNull();
    });
    it("без номера й без платника нічого не зіставляємо", () => {
      expect(decideAutoMatch(payment(), [order()], 0)).toBeNull();
    });
  });
});
