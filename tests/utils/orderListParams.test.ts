import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  dayRange,
  hasActiveSearch,
  MAX_SEARCH_LENGTH,
  ORDER_LIST_PARAMS,
  parseOrderListParams,
  weekRange,
} from "@/utils/orderListParams";

// 12.11.2026 це четвер.
const TODAY = "2026-11-12";
const MANAGER = "22222222-2222-4222-8222-222222222222";

describe("дні й тиждень", () => {
  it("тиждень від понеділка до неділі, в будь-який день тижня", () => {
    for (const day of ["2026-11-09", "2026-11-12", "2026-11-15"]) {
      expect(weekRange(day), day).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    }
    expect(weekRange("2026-11-16")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
  });

  it("тиждень через межу місяця й року", () => {
    expect(weekRange("2026-12-31")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(weekRange("2026-03-01")).toEqual({ from: "2026-02-23", to: "2026-03-01" });
  });

  it("вчора, сьогодні, завтра це по одному дню", () => {
    expect(dayRange("yesterday", TODAY)).toEqual({ from: "2026-11-11", to: "2026-11-11" });
    expect(dayRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(dayRange("tomorrow", TODAY)).toEqual({ from: "2026-11-13", to: "2026-11-13" });
    expect(dayRange("week", TODAY)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });
});

describe("стан списку замовлень в адресі", () => {
  it("порожня адреса показує сьогодні", () => {
    expect(parseOrderListParams({}, TODAY)).toEqual({
      day: "today",
      dateFrom: TODAY,
      dateTo: TODAY,
      status: "",
      managerId: "",
      deliveryMethod: "",
      search: "",
    });
  });

  it("читає день, статус, менеджера, спосіб доставки й пошук", () => {
    const filters = parseOrderListParams(
      {
        [ORDER_LIST_PARAMS.day]: "tomorrow",
        [ORDER_LIST_PARAMS.status]: "confirmed",
        [ORDER_LIST_PARAMS.manager]: MANAGER,
        [ORDER_LIST_PARAMS.delivery]: "np",
        [ORDER_LIST_PARAMS.search]: "  Вогник ",
      },
      TODAY,
    );
    expect(filters).toEqual({
      day: "tomorrow",
      dateFrom: "2026-11-13",
      dateTo: "2026-11-13",
      status: "confirmed",
      managerId: MANAGER,
      deliveryMethod: "np",
      search: "Вогник",
    });
  });

  it("вручну вказані дати сильніші за день, перевернутий діапазон розвертається", () => {
    const range = parseOrderListParams(
      { day: "week", from: "2026-11-01", to: "2026-11-05" },
      TODAY,
    );
    expect(range).toMatchObject({ day: "range", dateFrom: "2026-11-01", dateTo: "2026-11-05" });
    const swapped = parseOrderListParams({ from: "2026-11-20", to: "2026-11-10" }, TODAY);
    expect(swapped).toMatchObject({ dateFrom: "2026-11-10", dateTo: "2026-11-20" });
  });

  it("одна з дат теж діапазон, неіснуюча дата відкидається", () => {
    expect(parseOrderListParams({ from: "2026-11-01" }, TODAY)).toMatchObject({
      day: "range",
      dateFrom: "2026-11-01",
      dateTo: "",
    });
    expect(parseOrderListParams({ to: "2026-11-30" }, TODAY)).toMatchObject({
      day: "range",
      dateFrom: "",
      dateTo: "2026-11-30",
    });
    expect(parseOrderListParams({ from: "2026-02-31", to: "вчора" }, TODAY)).toMatchObject({
      day: "today",
    });
  });

  it("сміття в адресі відкидається, а не ламає сторінку", () => {
    const filters = parseOrderListParams(
      { day: "next-year", status: "' or 1=1", manager: "m1", delivery: "drone", q: ["А", "Б"] },
      TODAY,
    );
    expect(filters).toMatchObject({
      day: "today",
      status: "",
      managerId: "",
      deliveryMethod: "",
      search: "А",
    });
  });

  it("надто довгий пошук обрізається", () => {
    expect(parseOrderListParams({ q: "а".repeat(500) }, TODAY).search).toHaveLength(
      MAX_SEARCH_LENGTH,
    );
  });

  it("лічильник фільтрів не рахує день і пошук", () => {
    const base = parseOrderListParams({}, TODAY);
    expect(countActiveFilters(base)).toBe(0);
    expect(countActiveFilters({ ...base, search: "а", day: "week" })).toBe(0);
    expect(
      countActiveFilters({ ...base, status: "draft", managerId: MANAGER, deliveryMethod: "np" }),
    ).toBe(3);
  });

  it("порожній стан: день за замовчуванням не фільтр, діапазон, пошук і фільтри так", () => {
    const base = parseOrderListParams({}, TODAY);
    expect(hasActiveSearch(base)).toBe(false);
    expect(hasActiveSearch({ ...base, day: "week" })).toBe(false);
    expect(hasActiveSearch({ ...base, search: "а" })).toBe(true);
    expect(hasActiveSearch({ ...base, status: "draft" })).toBe(true);
    expect(hasActiveSearch(parseOrderListParams({ from: "2026-11-01" }, TODAY))).toBe(true);
  });
});
