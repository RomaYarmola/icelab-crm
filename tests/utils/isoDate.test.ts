import { describe, expect, it } from "vitest";
import { addDays, formatIsoDate, isIsoDate, todayIso } from "@/utils/isoDate";

describe("isIsoDate", () => {
  it("приймає існуючі дати", () => {
    for (const value of ["2026-11-12", "2024-02-29", "2026-01-01", "2026-12-31"]) {
      expect(isIsoDate(value), value).toBe(true);
    }
  });

  it("відхиляє неіснуючі дати й інші формати", () => {
    for (const value of [
      "2026-02-30",
      "2025-02-29",
      "2026-13-01",
      "2026-00-10",
      "12.11.2026",
      "2026-1-5",
      "",
      "abc",
    ]) {
      expect(isIsoDate(value), value).toBe(false);
    }
  });
});

describe("addDays", () => {
  it("додає й віднімає дні, переходячи через місяць і рік", () => {
    expect(addDays("2026-11-12", 1)).toBe("2026-11-13");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("не зсуває дату на переході на літній і зимовий час", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", -1)).toBe("2026-10-24");
  });

  it("кидає помилку для некоректної дати", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow("Некоректна дата");
  });
});

describe("todayIso", () => {
  it("дає дату за київським часом, а не за UTC", () => {
    // 22:30 UTC 11 листопада це вже 00:30 12 листопада в Києві (зима, UTC+2).
    expect(todayIso(new Date("2026-11-11T22:30:00Z"))).toBe("2026-11-12");
    expect(todayIso(new Date("2026-11-11T10:00:00Z"))).toBe("2026-11-11");
    // Літо (UTC+3): 21:30 UTC уже наступна доба.
    expect(todayIso(new Date("2026-07-01T21:30:00Z"))).toBe("2026-07-02");
  });
});

describe("formatIsoDate", () => {
  it("показує дату як день.місяць.рік", () => {
    expect(formatIsoDate("2026-11-12")).toBe("12.11.2026");
    expect(formatIsoDate("nonsense")).toBe("nonsense");
  });
});
