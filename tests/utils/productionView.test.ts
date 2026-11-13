import { describe, expect, it } from "vitest";
import { parseProductionParams } from "@/utils/productionParams";
import { dayLabel, describeBoxes, formatClock, formatKgPlain } from "@/utils/productionView";

describe("екран виробництва: підписи", () => {
  describe("тара", () => {
    it("наша тара з кількістю, без тари нічого", () => {
      expect(
        describeBoxes({ boxTypeName: "Наш довгий 46 л", boxCount: 2, boxOwnership: "ours" }),
      ).toBe("Наш довгий 46 л × 2");
      expect(describeBoxes({ boxTypeName: null, boxCount: 3, boxOwnership: "ours" })).toBe(
        "Тара × 3",
      );
      expect(
        describeBoxes({ boxTypeName: "Наш довгий 46 л", boxCount: 0, boxOwnership: "ours" }),
      ).toBeNull();
    });

    it("чужа тара це «Бокс клієнта», продана з приміткою", () => {
      expect(
        describeBoxes({ boxTypeName: "Бокс клієнта", boxCount: 1, boxOwnership: "client" }),
      ).toBe("Бокс клієнта × 1");
      expect(describeBoxes({ boxTypeName: "50 кг білий", boxCount: 2, boxOwnership: "sold" })).toBe(
        "50 кг білий × 2, продаємо",
      );
    });
  });

  describe("час і день", () => {
    it("час за Києвом у вигляді ГГ:ХХ", () => {
      // 12:05 UTC це 14:05 у Києві взимку (UTC+2).
      expect(formatClock("2026-11-13T12:05:00Z")).toBe("14:05");
      expect(formatClock(new Date("2026-07-13T12:05:00Z"))).toBe("15:05");
    });

    it("сьогодні, завтра, вчора або дата", () => {
      expect(dayLabel("2026-11-13", "2026-11-13")).toBe("Сьогодні");
      expect(dayLabel("2026-11-14", "2026-11-13")).toBe("Завтра");
      expect(dayLabel("2026-11-12", "2026-11-13")).toBe("Вчора");
      expect(dayLabel("2026-11-20", "2026-11-13")).toBe("20.11.2026");
    });

    it("кг без зайвих нулів, з комою", () => {
      expect(formatKgPlain(33)).toBe("33");
      expect(formatKgPlain(22.5)).toBe("22,5");
    });
  });

  describe("параметри адреси", () => {
    const today = "2026-11-13";
    it("за замовчуванням сьогодні й звичайний режим", () => {
      expect(parseProductionParams({}, today)).toEqual({ date: today, wall: false });
    });
    it("день і режим «на стіні» з адреси", () => {
      expect(parseProductionParams({ date: "2026-11-14", mode: "wall" }, today)).toEqual({
        date: "2026-11-14",
        wall: true,
      });
    });
    it("некоректні значення відкидаються", () => {
      expect(parseProductionParams({ date: "завтра", mode: "big" }, today)).toEqual({
        date: today,
        wall: false,
      });
      expect(parseProductionParams({ date: ["2026-11-15", "x"], mode: ["wall"] }, today)).toEqual({
        date: "2026-11-15",
        wall: true,
      });
    });
  });
});
