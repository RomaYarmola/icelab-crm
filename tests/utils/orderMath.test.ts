import { describe, expect, it } from "vitest";
import {
  computeKgToProduce,
  formatKopecks,
  lineAmount,
  parseDecimal,
  sumAmounts,
} from "@/utils/orderMath";

describe("скільки виготовити (D53)", () => {
  it("без надбавки стільки, скільки продано", () => {
    expect(computeKgToProduce(30, 0)).toBe(30);
    expect(computeKgToProduce(12, 0)).toBe(12);
  });

  it("10% від 30 кг це рівно 33, а не 34 (дроби не ламають округлення)", () => {
    // 30 × 1,1 у дробах дає 33,00000000000004.
    expect(computeKgToProduce(30, 10)).toBe(33);
    expect(computeKgToProduce(10, 10)).toBe(11);
    expect(computeKgToProduce(100, 15)).toBe(115);
  });

  it("нецілий результат округлюється вгору", () => {
    expect(computeKgToProduce(12, 10)).toBe(14); // 13,2
    expect(computeKgToProduce(25, 10)).toBe(28); // 27,5
    expect(computeKgToProduce(1, 10)).toBe(2); // 1,1
  });

  it("дробові кілограми й відсотки", () => {
    expect(computeKgToProduce(12.5, 0)).toBe(13);
    expect(computeKgToProduce(12.5, 10)).toBe(14); // 13,75
    expect(computeKgToProduce(30, 16.67)).toBe(36); // 35,001
    expect(computeKgToProduce(0.001, 10)).toBe(1);
  });

  it("нуль, від'ємні й сміття дають 0, відсоток обмежений від 0 до 100", () => {
    expect(computeKgToProduce(0, 10)).toBe(0);
    expect(computeKgToProduce(-5, 10)).toBe(0);
    expect(computeKgToProduce(Number.NaN, 10)).toBe(0);
    expect(computeKgToProduce(30, -10)).toBe(30);
    expect(computeKgToProduce(30, 500)).toBe(60);
    expect(computeKgToProduce(30, Number.NaN)).toBe(30);
  });

  it("великі замовлення", () => {
    expect(computeKgToProduce(5000, 10)).toBe(5500);
    expect(computeKgToProduce(9999.999, 15)).toBe(11500);
  });
});

describe("суми позицій і замовлення (D12, D55)", () => {
  it("сума позиції: кількість на ціну, до копійки", () => {
    expect(lineAmount(30, 75)).toBe("2250.00");
    expect(lineAmount(12.5, 75)).toBe("937.50");
    expect(lineAmount(1, 99.9)).toBe("99.90");
    expect(lineAmount(0, 75)).toBe("0.00");
  });

  it("округлення до копійки так само, як у базі (половина вгору)", () => {
    expect(lineAmount(0.333, 10)).toBe("3.33");
    expect(lineAmount(0.5, 0.01)).toBe("0.01"); // 0,005
    expect(lineAmount(2.5, 0.01)).toBe("0.03"); // 0,025
  });

  it("сума замовлення це сума позицій без втрат на копійках", () => {
    expect(sumAmounts(["2250.00", "150.00", "0.10", "0.20"])).toBe("2400.30");
    expect(sumAmounts([])).toBe("0.00");
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
  });

  it("копійки у гривні", () => {
    expect(formatKopecks(225000)).toBe("2250.00");
    expect(formatKopecks(5)).toBe("0.05");
    expect(formatKopecks(0)).toBe("0.00");
  });
});

describe("число з рядка бази чи поля форми", () => {
  it("розуміє крапку, кому й пробіли, решту відхиляє", () => {
    expect(parseDecimal("30.000")).toBe(30);
    expect(parseDecimal(" 12,5 ")).toBe(12.5);
    expect(parseDecimal(7)).toBe(7);
    expect(parseDecimal("")).toBeNaN();
    expect(parseDecimal("12 кг")).toBeNaN();
    expect(parseDecimal("1e3")).toBeNaN();
  });
});
