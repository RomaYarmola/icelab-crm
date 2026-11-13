import { describe, expect, it } from "vitest";
import {
  countActiveAuditFilters,
  hasActiveAuditSearch,
  parseAuditParams,
  toAuditQuery,
} from "@/utils/auditParams";

const ACTOR = "11111111-2222-4333-8444-555555555555";

describe("журнал змін: стан в адресі (D89)", () => {
  it("порожня адреса дає порожні фільтри", () => {
    expect(parseAuditParams({})).toEqual({
      section: "",
      actorId: "",
      dateFrom: "",
      dateTo: "",
      search: "",
    });
    expect(hasActiveAuditSearch(parseAuditParams({}))).toBe(false);
  });

  it("розділ, користувач, дні й пошук розбираються", () => {
    const filters = parseAuditParams({
      section: "cash",
      actor: ACTOR,
      from: "2026-11-01",
      to: "2026-11-13",
      q: "  3472 ",
    });
    expect(filters).toEqual({
      section: "cash",
      actorId: ACTOR,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-13",
      search: "3472",
    });
    expect(countActiveAuditFilters(filters)).toBe(4);
    expect(toAuditQuery(filters)).toEqual({
      section: "cash",
      actorId: ACTOR,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-13",
      search: "3472",
    });
  });

  it("некоректні значення відкидаються, довгий пошук обрізається, масив бере перше", () => {
    const filters = parseAuditParams({
      section: "щось",
      actor: "xx",
      from: "вчора",
      to: ["2026-11-02", "x"],
      q: "а".repeat(100),
    });
    expect(filters.section).toBe("");
    expect(filters.actorId).toBe("");
    expect(filters.dateFrom).toBe("");
    expect(filters.dateTo).toBe("2026-11-02");
    expect(filters.search).toHaveLength(60);
    expect(toAuditQuery(parseAuditParams({}))).toEqual({
      section: undefined,
      actorId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      search: undefined,
    });
  });
});
