import { describe, expect, it } from "vitest";
import {
  amountField,
  buildDebtMessage,
  cleanPaymentLink,
  joinNumbers,
  PURPOSE_MAX,
  purposeFor,
  splitPaymentGroups,
} from "@/utils/debtMessage";

describe("повідомлення клієнтові з боргом (D197)", () => {
  const orders = [
    { number: 1360, orderDate: "2026-11-23", remaining: "2250.00" },
    { number: 1340, orderDate: "2026-11-21", remaining: "2250.00" },
    { number: 1351, orderDate: "2026-11-22", remaining: "1000.50" },
  ];

  it("номери в тексті призначення за зростанням, з «та» перед останнім", () => {
    expect(joinNumbers([1340])).toBe("1340");
    expect(joinNumbers([1340, 1351])).toBe("1340 та 1351");
    expect(joinNumbers([1340, 1351, 1360])).toBe("1340, 1351 та 1360");
  });

  it("сума, перелік і призначення платежу; реквізити додаються блоком", () => {
    const text = buildDebtMessage(orders, "Отримувач: ФОП Тест\nРахунок: UA00");
    expect(text).toContain("«Оплата за замовлення №1340, 1351 та 1360»");
    expect(text).toMatch(/До сплати: 5\s?500,50/);
    expect(text.indexOf("№1340")).toBeLessThan(text.indexOf("№1351"));
    expect(text).toContain("Реквізити для оплати:\nОтримувач: ФОП Тест");
  });

  it("без реквізитів блоку немає; без замовлень тексту немає", () => {
    expect(buildDebtMessage(orders, null)).not.toContain("Реквізити");
    expect(buildDebtMessage([], "x")).toBe("");
  });

  describe("посилання на оплату для плану «Стандарт» (D202)", () => {
    it("одна група: сума в копійках, призначення в межах ліміту, номери за зростанням", () => {
      const groups = splitPaymentGroups(orders);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        numbers: [1340, 1351, 1360],
        kopecks: 550050,
        purpose: "Оплата за замовлення №1340, 1351 та 1360",
      });
      expect(purposeFor([1340])).toBe("Оплата за замовлення №1340");
    });

    it("довгий перелік ділиться на кілька груп, кожна не довша за 140 символів", () => {
      const many = Array.from({ length: 40 }, (_, i) => ({
        number: 1000 + i,
        orderDate: "2026-11-21",
        remaining: "100.00",
      }));
      const groups = splitPaymentGroups(many);
      expect(groups.length).toBeGreaterThan(1);
      for (const group of groups) expect(group.purpose.length).toBeLessThanOrEqual(PURPOSE_MAX);
      expect(groups.flatMap((g) => g.numbers)).toEqual(many.map((o) => o.number));
      expect(groups.reduce((sum, g) => sum + g.kopecks, 0)).toBe(400000);
    });

    it("поле «Сума» без пробілів і валюти", () => {
      expect(amountField(225000)).toBe("2250");
      expect(amountField(100050)).toBe("1000,50");
    });

    it("посилання приймаємо лише https без пробілів", () => {
      expect(cleanPaymentLink(" https://ibanoplata.com/iban-qr/abc ")).toBe(
        "https://ibanoplata.com/iban-qr/abc",
      );
      expect(cleanPaymentLink("http://x.com")).toBeNull();
      expect(cleanPaymentLink("javascript:alert(1)")).toBeNull();
      expect(cleanPaymentLink("https://a b")).toBeNull();
      expect(cleanPaymentLink(undefined)).toBeNull();
    });

    it("повідомлення з посиланням; без посилання його рядка немає", () => {
      const withLink = buildDebtMessage(orders, null, ["https://ibanoplata.com/iban-qr/abc"]);
      expect(withLink).toContain("Оплатити за посиланням: https://ibanoplata.com/iban-qr/abc");
      expect(buildDebtMessage(orders, null)).not.toContain("посиланням");
      expect(buildDebtMessage(orders, null, ["не посилання"])).not.toContain("посиланням");
    });

    it("кілька груп: платежі пронумеровано, посилання йдуть за порядком груп", () => {
      const many = Array.from({ length: 40 }, (_, i) => ({
        number: 1000 + i,
        orderDate: "2026-11-21",
        remaining: "100.00",
      }));
      const text = buildDebtMessage(many, null, ["https://ibanoplata.com/iban-qr/one"]);
      expect(text).toContain("платежами:");
      expect(text).toContain("1) ");
      expect(text).toContain(": https://ibanoplata.com/iban-qr/one");
      expect(text).toContain("2) ");
    });
  });
});
