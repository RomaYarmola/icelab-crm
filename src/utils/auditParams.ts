import { AUDIT_SECTION_ORDER, type AuditSection } from "@/server/audit-labels";
import { isIsoDate } from "./isoDate";

/**
 * Стан журналу змін в адресі сторінки (D89): розділ, користувач, дні й пошук за номером замовлення
 * чи кодом клієнта. Посиланням можна поділитись, «Назад» повертає до того самого списку.
 * Некоректні значення відкидаємо.
 */

export const AUDIT_PARAMS = {
  section: "section",
  actor: "actor",
  from: "from",
  to: "to",
  search: "q",
} as const;

export type AuditListFilters = {
  section: AuditSection | "";
  actorId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAuditParams(raw: RawParams): AuditListFilters {
  const section = first(raw[AUDIT_PARAMS.section]);
  const actor = first(raw[AUDIT_PARAMS.actor]);
  const from = first(raw[AUDIT_PARAMS.from]);
  const to = first(raw[AUDIT_PARAMS.to]);
  return {
    section: (AUDIT_SECTION_ORDER as string[]).includes(section) ? (section as AuditSection) : "",
    actorId: UUID.test(actor) ? actor : "",
    dateFrom: isIsoDate(from) ? from : "",
    dateTo: isIsoDate(to) ? to : "",
    search: first(raw[AUDIT_PARAMS.search]).trim().slice(0, 60),
  };
}

/** Фільтри для серверної функції: порожні значення не передаємо. */
export function toAuditQuery(filters: AuditListFilters) {
  return {
    section: filters.section || undefined,
    actorId: filters.actorId || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    search: filters.search || undefined,
  };
}

/** Скільки фільтрів увімкнено (для підпису «Фільтри · 2»); пошук не рахуємо, він окремий рядок. */
export function countActiveAuditFilters(filters: AuditListFilters): number {
  return [filters.section, filters.actorId, filters.dateFrom, filters.dateTo].filter(Boolean)
    .length;
}

export const hasActiveAuditSearch = (filters: AuditListFilters): boolean =>
  countActiveAuditFilters(filters) > 0 || filters.search !== "";
