import { describe, expect, it } from "vitest";
import { buildDebtMessage, joinNumbers } from "@/utils/debtMessage";

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
});
