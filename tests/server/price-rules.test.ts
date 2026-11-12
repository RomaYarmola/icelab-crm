import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import { parsePriceDate, parsePricePerKg, planPriceChange } from "@/server/price-rules";

describe("parsePricePerKg", () => {
  it("приймає число з крапкою, комою, пробілами й число типу number", () => {
    expect(parsePricePerKg("60")).toBe("60.00");
    expect(parsePricePerKg("60.5")).toBe("60.50");
    expect(parsePricePerKg("60,50")).toBe("60.50");
    expect(parsePricePerKg(" 1 250,5 ")).toBe("1250.50");
    expect(parsePricePerKg(75)).toBe("75.00");
    expect(parsePricePerKg("0.01")).toBe("0.01");
  });

  it("відхиляє нуль, мінус, текст, порожнє, зайві знаки й завелику ціну", () => {
    for (const input of ["0", "0,00", "-5", "abc", "", "  ", "60.555", "1e3", "60,5,5", "100000"]) {
      expect(() => parsePricePerKg(input), input).toThrow(ValidationError);
    }
  });
});

describe("parsePriceDate", () => {
  it("приймає існуючу дату, інакше помилка", () => {
    expect(parsePriceDate(" 2026-11-12 ")).toBe("2026-11-12");
    expect(() => parsePriceDate("2026-02-30")).toThrow(ValidationError);
    expect(() => parsePriceDate("")).toThrow("Вкажіть дату");
  });
});

describe("planPriceChange (D45)", () => {
  const open = { id: "p1", pricePerKg: "60.00", validFrom: "2026-11-01" };

  it("для першої ціни просто додає", () => {
    expect(planPriceChange({ open: null, pricePerKg: "60.00", validFrom: "2026-11-12" })).toEqual({
      kind: "insert",
      validFrom: "2026-11-12",
    });
    // Перша ціна може бути і майбутньою.
    expect(planPriceChange({ open: null, pricePerKg: "60.00", validFrom: "2027-01-01" }).kind).toBe(
      "insert",
    );
  });

  it("закриває чинну днем перед новою датою і додає нову", () => {
    expect(planPriceChange({ open, pricePerKg: "70.00", validFrom: "2026-11-15" })).toEqual({
      kind: "replace",
      closeId: "p1",
      closeTo: "2026-11-14",
      validFrom: "2026-11-15",
    });
  });

  it("майбутня дата теж дозволена: стара діє до дня перед нею", () => {
    expect(planPriceChange({ open, pricePerKg: "70.00", validFrom: "2027-01-01" })).toMatchObject({
      kind: "replace",
      closeTo: "2026-12-31",
    });
  });

  it("початок чинної ціни плюс один день теж працює (стара живе один день)", () => {
    expect(planPriceChange({ open, pricePerKg: "70.00", validFrom: "2026-11-02" })).toMatchObject({
      kind: "replace",
      closeTo: "2026-11-01",
    });
  });

  it("у той самий день виправляє ціну в тому самому рядку", () => {
    expect(planPriceChange({ open, pricePerKg: "65.00", validFrom: "2026-11-01" })).toEqual({
      kind: "correct",
      id: "p1",
    });
  });

  it("раніше початку чинної ціни не можна", () => {
    expect(() => planPriceChange({ open, pricePerKg: "70.00", validFrom: "2026-10-31" })).toThrow(
      "раніше початку чинної ціни (01.11.2026)",
    );
  });

  it("та сама ціна, що вже діє, це помилка (навіть із пізнішою датою)", () => {
    expect(() => planPriceChange({ open, pricePerKg: "60.00", validFrom: "2026-11-15" })).toThrow(
      "вже діє",
    );
    expect(() => planPriceChange({ open, pricePerKg: "60", validFrom: "2026-11-01" })).toThrow(
      "вже діє",
    );
  });
});
