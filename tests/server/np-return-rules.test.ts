import { describe, expect, it } from "vitest";
import { lightReturnNumber, parseNpDate, returnLocationId } from "@/server/np/return-rules";

describe("правила повернень боксів (B17)", () => {
  it("номер повернення це 14 цифр, відмінних від номера відправки", () => {
    expect(lightReturnNumber("20450000000002", "20450000000001")).toBe("20450000000002");
    expect(lightReturnNumber(" 20450000000002 ", "20450000000001")).toBe("20450000000002");
    for (const value of ["", undefined, null, "0", "abc", {}, "20450000000001"]) {
      expect(lightReturnNumber(value, "20450000000001")).toBeNull();
    }
  });

  it("дати Нової Пошти читаються за київським часом, взимку й улітку", () => {
    expect(parseNpDate("2026-11-25 09:59:42")?.toISOString()).toBe("2026-11-25T07:59:42.000Z");
    expect(parseNpDate("25.07.2026 16:06:49")?.toISOString()).toBe("2026-07-25T13:06:49.000Z");
    expect(parseNpDate("24-11-2026 09:59:19")?.toISOString()).toBe("2026-11-24T07:59:19.000Z");
    expect(parseNpDate("2026-12-01")?.toISOString()).toBe("2026-11-30T22:00:00.000Z");
  });

  it("порожня, нульова чи незрозуміла дата це null", () => {
    for (const value of ["", "0001-01-01 00:00:00", "скоро", undefined, 5]) {
      expect(parseNpDate(value)).toBeNull();
    }
  });

  it("список визначає місто отримання, інакше локація відправки", () => {
    const places = [
      { id: "k", name: "Київ" },
      { id: "l", name: "Львів" },
    ];
    expect(returnLocationId("Львів", places, "k")).toBe("l");
    expect(returnLocationId(" київ ", places, "l")).toBe("k");
    expect(returnLocationId("Чернігів", places, "l")).toBe("l");
    expect(returnLocationId(null, places, "k")).toBe("k");
  });
});
