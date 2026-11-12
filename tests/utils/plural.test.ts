import { describe, expect, it } from "vitest";
import { pluralUk } from "@/utils/plural";

const TYPES = ["тип", "типи", "типів"] as const;

describe("відмінювання за числом (українська)", () => {
  it("1, 21, 101 це перша форма", () => {
    for (const n of [1, 21, 31, 101]) expect(pluralUk(n, TYPES), String(n)).toBe("тип");
  });

  it("2-4, 22-24 це друга форма", () => {
    for (const n of [2, 3, 4, 22, 24, 102]) expect(pluralUk(n, TYPES), String(n)).toBe("типи");
  });

  it("0, 5-20, 25-30 це третя форма, а 11-14 завжди третя", () => {
    for (const n of [0, 5, 9, 10, 11, 12, 13, 14, 15, 20, 25, 111, 112]) {
      expect(pluralUk(n, TYPES), String(n)).toBe("типів");
    }
  });

  it("від'ємні числа відмінюються за модулем", () => {
    expect(pluralUk(-1, TYPES)).toBe("тип");
    expect(pluralUk(-5, TYPES)).toBe("типів");
  });
});
