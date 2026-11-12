import { describe, expect, it } from "vitest";
import type { ClientPriceHistoryItem, DefaultPriceHistoryItem } from "@/server/prices";
import {
  ANY_ICE_TYPE_LABEL,
  describePeriod,
  effectivePriceFor,
  groupClientPrices,
  groupDefaultPrices,
  isActiveOn,
  isUpcoming,
} from "@/utils/priceView";

const TODAY = "2026-11-12";
const GRANULES = "ice-granules";
const BLOCKS = "ice-blocks";

const client = (
  iceTypeId: string | null,
  pricePerKg: string,
  validFrom: string,
  validTo: string | null = null,
): ClientPriceHistoryItem => ({
  id: `c-${iceTypeId}-${validFrom}`,
  iceTypeId,
  iceTypeName: iceTypeId === GRANULES ? "Гранули" : iceTypeId === BLOCKS ? "Блоки" : null,
  pricePerKg,
  validFrom,
  validTo,
});

const base = (
  iceTypeId: string,
  pricePerKg: string,
  validFrom: string,
  validTo: string | null = null,
): DefaultPriceHistoryItem => ({
  id: `d-${iceTypeId}-${validFrom}`,
  iceTypeId,
  iceTypeName: iceTypeId === GRANULES ? "Гранули" : "Блоки",
  pricePerKg,
  validFrom,
  validTo,
});

describe("чинність ціни на дату", () => {
  const price = { pricePerKg: "75", validFrom: "2026-11-01", validTo: "2026-11-30" };

  it("діє з першого до останнього дня включно", () => {
    expect(isActiveOn(price, "2026-11-01")).toBe(true);
    expect(isActiveOn(price, "2026-11-30")).toBe(true);
    expect(isActiveOn(price, "2026-10-31")).toBe(false);
    expect(isActiveOn(price, "2026-12-01")).toBe(false);
  });

  it("ціна без кінця діє завжди після початку", () => {
    expect(isActiveOn({ ...price, validTo: null }, "2030-01-01")).toBe(true);
  });

  it("майбутня ціна ще не діє, але вже «настане»", () => {
    expect(isUpcoming({ ...price, validFrom: "2026-12-01", validTo: null }, TODAY)).toBe(true);
    expect(isUpcoming(price, TODAY)).toBe(false);
  });
});

describe("яка ціна діє для типу льоду", () => {
  it("індивідуальна на цей тип сильніша за решту", () => {
    const result = effectivePriceFor(
      GRANULES,
      [client(GRANULES, "70", "2026-10-01"), client(null, "65", "2026-10-01")],
      [base(GRANULES, "75", "2026-01-01")],
      TODAY,
    );
    expect(result.source).toBe("client");
    expect(result.current).toEqual({ pricePerKg: "70", validFrom: "2026-10-01" });
  });

  it("без ціни на тип береться індивідуальна «для будь-якого типу»", () => {
    const result = effectivePriceFor(
      BLOCKS,
      [client(GRANULES, "70", "2026-10-01"), client(null, "65", "2026-10-01")],
      [base(BLOCKS, "75", "2026-01-01")],
      TODAY,
    );
    expect(result.source).toBe("client_any_type");
    expect(result.current?.pricePerKg).toBe("65");
  });

  it("без індивідуальних береться прайс цього типу", () => {
    const result = effectivePriceFor(
      GRANULES,
      [],
      [base(GRANULES, "75", "2026-01-01"), base(BLOCKS, "90", "2026-01-01")],
      TODAY,
    );
    expect(result.source).toBe("default");
    expect(result.current?.pricePerKg).toBe("75");
  });

  it("закрита ціна не береться: діє наступний рівень", () => {
    const result = effectivePriceFor(
      GRANULES,
      [client(GRANULES, "70", "2026-09-01", "2026-10-31")],
      [base(GRANULES, "75", "2026-01-01")],
      TODAY,
    );
    expect(result.source).toBe("default");
  });

  it("ціна, що починається завтра, ще не діє, але показується як майбутня", () => {
    const result = effectivePriceFor(
      GRANULES,
      [client(GRANULES, "70", "2026-10-01", "2026-11-12"), client(GRANULES, "80", "2026-11-13")],
      [],
      TODAY,
    );
    expect(result.source).toBe("client");
    expect(result.current?.pricePerKg).toBe("70");
    expect(result.upcoming).toEqual({ pricePerKg: "80", validFrom: "2026-11-13" });
  });

  it("клієнту з прайсом призначили свою ціну на завтра: вона видна як майбутня", () => {
    const result = effectivePriceFor(
      GRANULES,
      [client(null, "65", "2026-11-13")],
      [base(GRANULES, "75", "2026-01-01")],
      TODAY,
    );
    expect(result.source).toBe("default");
    expect(result.current?.pricePerKg).toBe("75");
    expect(result.upcoming).toEqual({ pricePerKg: "65", validFrom: "2026-11-13" });
  });

  it("майбутня ціна нижчого рівня не перекриває діючу індивідуальну", () => {
    const result = effectivePriceFor(
      GRANULES,
      [client(GRANULES, "70", "2026-10-01")],
      [base(GRANULES, "75", "2026-01-01"), base(GRANULES, "80", "2026-12-01")],
      TODAY,
    );
    expect(result.source).toBe("client");
    expect(result.upcoming).toBeNull();
  });

  it("нічого не діє, лише майбутній прайс: джерела немає, майбутня ціна видна", () => {
    const result = effectivePriceFor(GRANULES, [], [base(GRANULES, "75", "2026-12-01")], TODAY);
    expect(result.source).toBe("none");
    expect(result.current).toBeNull();
    expect(result.upcoming?.pricePerKg).toBe("75");
  });

  it("ціни немає ніде", () => {
    expect(effectivePriceFor(GRANULES, [], [], TODAY)).toEqual({
      source: "none",
      current: null,
      upcoming: null,
    });
  });
});

describe("групи історії цін", () => {
  it("група на тип льоду, у групі нова ціна першою, «для будь-якого» окремою групою", () => {
    const groups = groupClientPrices([
      client(null, "65", "2026-10-01"),
      client(GRANULES, "70", "2026-09-01", "2026-09-30"),
      client(GRANULES, "72", "2026-10-01"),
    ]);
    expect(groups.map((group) => group.title)).toEqual([ANY_ICE_TYPE_LABEL, "Гранули"]);
    expect(groups[1]?.rows.map((row) => row.pricePerKg)).toEqual(["72", "70"]);
  });

  it("прайс групується за типом льоду, нові ціни першими", () => {
    const groups = groupDefaultPrices([
      base(GRANULES, "70", "2026-01-01", "2026-06-30"),
      base(GRANULES, "75", "2026-07-01"),
      base(BLOCKS, "90", "2026-01-01"),
    ]);
    expect(groups.map((group) => group.title)).toEqual(["Гранули", "Блоки"]);
    expect(groups[0]?.rows.map((row) => row.pricePerKg)).toEqual(["75", "70"]);
  });
});

describe("період дії ціни словами", () => {
  const price = (validFrom: string, validTo: string | null = null) => ({
    pricePerKg: "75",
    validFrom,
    validTo,
  });

  it("відкрита чинна ціна", () => {
    expect(describePeriod(price("2026-10-01"), TODAY)).toBe("з 01.10.2026, діє зараз");
  });

  it("закрита в минулому: лише період", () => {
    expect(describePeriod(price("2026-09-01", "2026-09-30"), TODAY)).toBe(
      "01.09.2026 – 30.09.2026",
    );
  });

  it("закрита, але ще діє (закінчиться в майбутньому)", () => {
    expect(describePeriod(price("2026-09-01", "2026-11-30"), TODAY)).toBe(
      "01.09.2026 – 30.11.2026, діє зараз",
    );
  });

  it("майбутня: ще не діє", () => {
    expect(describePeriod(price("2026-12-01"), TODAY)).toBe("з 01.12.2026, ще не діє");
  });
});
