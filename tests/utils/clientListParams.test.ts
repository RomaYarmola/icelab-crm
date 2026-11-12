import { describe, expect, it } from "vitest";
import {
  CLIENT_LIST_PARAMS,
  countActiveFilters,
  hasActiveSearch,
  MAX_SEARCH_LENGTH,
  parseClientListParams,
} from "@/utils/clientListParams";

const STATUS_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "22222222-2222-4222-8222-222222222222";
const APPLICATION_ID = "33333333-3333-4333-8333-333333333333";

describe("стан списку клієнтів в адресі", () => {
  it("порожня адреса дає порожні фільтри", () => {
    expect(parseClientListParams({})).toEqual({
      search: "",
      statusId: "",
      managerId: "",
      applicationId: "",
      includeDeleted: false,
    });
  });

  it("читає пошук і фільтри, пошук без зайвих пробілів", () => {
    const filters = parseClientListParams({
      [CLIENT_LIST_PARAMS.search]: "  Вогник ",
      [CLIENT_LIST_PARAMS.status]: STATUS_ID,
      [CLIENT_LIST_PARAMS.manager]: MANAGER_ID,
      [CLIENT_LIST_PARAMS.application]: APPLICATION_ID,
      [CLIENT_LIST_PARAMS.deleted]: "1",
    });
    expect(filters).toEqual({
      search: "Вогник",
      statusId: STATUS_ID,
      managerId: MANAGER_ID,
      applicationId: APPLICATION_ID,
      includeDeleted: true,
    });
  });

  it("фільтр, що не схожий на ідентифікатор, відкидається, а не ламає сторінку", () => {
    const filters = parseClientListParams({ status: "' or 1=1", manager: "m1", app: ["x"] });
    expect(filters.statusId).toBe("");
    expect(filters.managerId).toBe("");
    expect(filters.applicationId).toBe("");
  });

  it("з кількох однакових параметрів бере перший", () => {
    expect(parseClientListParams({ q: ["АА15", "ВС1"] }).search).toBe("АА15");
  });

  it("надто довгий пошук обрізається", () => {
    expect(parseClientListParams({ q: "а".repeat(500) }).search).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it("«видалені» вмикає лише значення 1", () => {
    expect(parseClientListParams({ deleted: "0" }).includeDeleted).toBe(false);
    expect(parseClientListParams({ deleted: "true" }).includeDeleted).toBe(false);
    expect(parseClientListParams({ deleted: "1" }).includeDeleted).toBe(true);
  });

  it("лічильник фільтрів не рахує пошук", () => {
    const base = parseClientListParams({});
    expect(countActiveFilters(base)).toBe(0);
    expect(countActiveFilters({ ...base, search: "а" })).toBe(0);
    expect(countActiveFilters({ ...base, statusId: STATUS_ID, includeDeleted: true })).toBe(2);
  });

  it("порожній стан залежить від того, чи є пошук або фільтр", () => {
    const base = parseClientListParams({});
    expect(hasActiveSearch(base)).toBe(false);
    expect(hasActiveSearch({ ...base, search: "а" })).toBe(true);
    expect(hasActiveSearch({ ...base, managerId: MANAGER_ID })).toBe(true);
  });
});
