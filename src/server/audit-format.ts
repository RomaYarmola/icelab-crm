import { formatDateTime } from "@/utils/formatDate";
import { formatKg, formatMoney, formatNumber, formatPricePerKg } from "@/utils/formatNumber";
import { formatIsoDate } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import { AUDIT_TABLES, type AuditField, type AuditRef } from "./audit-labels";

/**
 * Опис змін журналу людською мовою (B8, D90). Чисті функції без бази: значення з `audit_log.diff`
 * (як у базі) перетворюємо на «30 кг», «13.11.2026», «Підтверджено» чи назву клієнта.
 */

export type AuditChange = {
  label: string;
  /** Було. Для створення запису `null`. */
  before: string | null;
  /** Стало. Для видалення запису `null`. */
  after: string | null;
};

/** Назви, знайдені за ідентифікаторами (клієнт, локація, користувач…). */
export type AuditNames = Record<AuditRef, Map<string, string>>;

export const emptyNames = (): AuditNames => ({
  client: new Map(),
  location: new Map(),
  iceType: new Map(),
  source: new Map(),
  boxType: new Map(),
  address: new Map(),
  user: new Map(),
  application: new Map(),
  clientStatus: new Map(),
  order: new Map(),
});

export type AuditDiff = Record<string, { old?: unknown; new?: unknown }>;

const EMPTY = "порожньо";
const UNKNOWN_RECORD = "запис видалено";
const MAX_TEXT = 300;

function clip(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
}

/** Плоский об'єкт читається як «Ключ: значення; Ключ: значення», решту лишаємо як JSON. */
function describeFilters(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0) return "без фільтрів";
    if (entries.every(([, value]) => value === null || typeof value !== "object")) {
      return entries.map(([key, value]) => `${key}: ${String(value)}`).join("; ");
    }
  }
  return JSON.stringify(raw);
}

/** Значення поля за його видом. `null` і порожній рядок показуємо як «порожньо». */
export function formatAuditValue(field: AuditField, raw: unknown, names: AuditNames): string {
  if (raw === null || raw === undefined || raw === "") return EMPTY;
  switch (field.kind) {
    case "enum":
      return field.values[String(raw)] ?? String(raw);
    case "ref":
      return names[field.ref].get(String(raw)) ?? UNKNOWN_RECORD;
    case "bool":
      return raw === true || raw === "true" ? "так" : "ні";
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? formatIsoDate(String(raw)) : String(raw);
    case "timestamp": {
      const parsed = new Date(String(raw));
      return Number.isNaN(parsed.getTime()) ? String(raw) : formatDateTime(parsed);
    }
    case "kg":
      return formatKg(parseDecimal(String(raw)));
    case "money":
      return formatMoney(parseDecimal(String(raw)));
    case "moneyPerKg":
      return formatPricePerKg(parseDecimal(String(raw)));
    case "percent":
      return `${formatNumber(parseDecimal(String(raw)))}%`;
    case "number":
      return formatNumber(parseDecimal(String(raw)));
    case "json":
      return clip(typeof raw === "string" ? raw : JSON.stringify(raw));
    case "filters":
      return clip(typeof raw === "string" ? raw : describeFilters(raw));
    case "hidden":
      return "";
    default:
      return clip(String(raw));
  }
}

/** Ідентифікатори, які треба замінити назвами: `[вид, id]` для всіх видимих значень диффу. */
export function collectRefs(table: string, diff: AuditDiff): [AuditRef, string][] {
  const fields = AUDIT_TABLES[table]?.fields ?? {};
  const found: [AuditRef, string][] = [];
  for (const [column, change] of Object.entries(diff)) {
    const field = fields[column];
    if (!field || field.kind !== "ref") continue;
    for (const value of [change.old, change.new]) {
      if (typeof value === "string" && value !== "") found.push([field.ref, value]);
    }
  }
  return found;
}

export type AuditAction = "insert" | "update" | "delete";

/**
 * Зміни рядка журналу: для створення лише «стало», для видалення лише «було», для зміни обидва.
 * Службові (hidden) поля пропускаємо. Поля, що не описані в словнику, показуємо під сирою назвою,
 * щоб нічого не губилось (тест вимагає підписів, тож це лише страховка).
 */
export function buildChanges(
  table: string,
  action: AuditAction,
  diff: AuditDiff,
  names: AuditNames,
): AuditChange[] {
  const fields = AUDIT_TABLES[table]?.fields ?? {};
  const changes: AuditChange[] = [];
  for (const [column, change] of Object.entries(diff)) {
    const field: AuditField = fields[column] ?? { label: column, kind: "text" };
    if (field.kind === "hidden") continue;
    changes.push({
      label: field.label,
      before: action === "insert" ? null : formatAuditValue(field, change.old, names),
      after: action === "delete" ? null : formatAuditValue(field, change.new, names),
    });
  }
  return changes;
}

/**
 * Одне речення про запис: «Створено замовлення», «Змінено статус: Підтверджено → У виробництві»,
 * «Цех побачив замовлення». Технічні зміни (позначка «побачено») не мають списку полів.
 */
export function describeAuditEntry(
  table: string,
  action: AuditAction,
  diff: AuditDiff,
  changes: AuditChange[],
): { summary: string; changes: AuditChange[] } {
  const noun = AUDIT_TABLES[table]?.noun ?? "запис";
  const keys = Object.keys(diff);

  if (table === "orders" && action === "update") {
    if (keys.length === 1 && keys[0] === "seen_by_production_at") {
      return { summary: "Цех побачив замовлення", changes: [] };
    }
    const deleted = diff.deleted_at?.new;
    if (deleted !== undefined && deleted !== null) {
      return { summary: "Видалено чернетку замовлення", changes: [] };
    }
  }
  if (table === "exports" && action === "insert") {
    const what = changes.find((change) => change.label === "Що вивантажено")?.after;
    return { summary: `Вивантажено в Excel${what ? `: ${what}` : ""}`, changes };
  }
  if (table === "cash_entries" && action === "update" && diff.reversed_at?.new) {
    return { summary: "Сторновано запис готівки", changes };
  }
  if (table === "profiles" && action === "update" && keys.length === 1 && keys[0] === "is_active") {
    return {
      summary: diff.is_active?.new === true ? "Користувача увімкнено" : "Користувача вимкнено",
      changes: [],
    };
  }
  if (action === "update") {
    const status = changes.find((change) => change.label === "Статус");
    if (status && table === "orders") {
      return { summary: `Змінено статус: ${status.before} → ${status.after}`, changes };
    }
    return { summary: changes.length > 0 ? `Змінено ${noun}` : "Службова зміна", changes };
  }
  return { summary: `${action === "insert" ? "Створено" : "Видалено"} ${noun}`, changes };
}
