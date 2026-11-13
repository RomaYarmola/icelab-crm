import type { LoadMoreAuditResult } from "@/app/(app)/more/audit/actions";
import type { AuditEntryView, AuditPage } from "@/server/audit";
import { parseAuditParams } from "@/utils/auditParams";
import AuditPageContent from "../auditPage/AuditPageContent";

/**
 * Журнал змін з вигаданими даними для перегляду `/ui-kit/shell/<роль>?screen=audit`. Той самий
 * компонент, що й на сервері. Дані вигадані, живих записів тут немає.
 */

export const AUDIT_PREVIEW_SCREENS = ["audit", "audit-empty"] as const;
export type AuditPreviewScreen = (typeof AUDIT_PREVIEW_SCREENS)[number];

const entry = (
  id: string,
  at: string,
  overrides: Partial<AuditEntryView> & Pick<AuditEntryView, "summary" | "subject">,
): AuditEntryView => ({
  id,
  at,
  actorName: "Олена Коваль",
  action: "update",
  sectionLabel: "Замовлення",
  tableLabel: "Замовлення",
  href: "/orders/o1",
  changes: [],
  ...overrides,
});

export const PREVIEW_AUDIT_ENTRIES: AuditEntryView[] = [
  entry("a1", "2026-11-13T12:05:00Z", {
    summary: "Змінено замовлення",
    subject: "Замовлення № 3472 · Кафе «Вогник»",
    changes: [
      { label: "Кількість на продаж", before: "30 кг", after: "35 кг" },
      { label: "Виготовити", before: "33 кг", after: "39 кг" },
    ],
  }),
  entry("a2", "2026-11-13T11:40:00Z", {
    actorName: "Андрій Старший",
    summary: "Змінено статус: Підтверджено → У виробництві",
    subject: "Замовлення № 3471 · ФОП Іваненко",
    changes: [{ label: "Статус", before: "Підтверджено", after: "У виробництві" }],
  }),
  entry("a3", "2026-11-13T11:12:00Z", {
    actorName: "Тест: Виробництво",
    summary: "Цех побачив замовлення",
    subject: "Замовлення № 3470 · Івент-агенція «Дим»",
  }),
  entry("a4", "2026-11-13T10:30:00Z", {
    action: "insert",
    summary: "Створено запис готівки",
    subject: "Замовлення № 3469 · Склад №4",
    sectionLabel: "Готівка",
    tableLabel: "Запис готівки",
    href: "/more/cash?date=2026-11-13#order-o4",
    changes: [
      { label: "Сума", before: null, after: "1 000 ₴" },
      { label: "Дата прийому", before: null, after: "13.11.2026" },
      { label: "Хто прийняв", before: null, after: "Водій Іван" },
      { label: "Звідки внесено", before: null, after: "бот водія" },
    ],
  }),
  entry("a5", "2026-11-13T09:10:00Z", {
    actorName: "Система",
    summary: "Змінено статус: Оплачено → Закрито",
    subject: "Замовлення № 3469 · Склад №4",
    changes: [{ label: "Статус", before: "Оплачено", after: "Закрито" }],
  }),
  entry("a6", "2026-11-12T16:00:00Z", {
    action: "delete",
    summary: "Видалено позицію замовлення",
    subject: "Замовлення № 3472 · Кафе «Вогник» · позиція «Доставка по Києву»",
    tableLabel: "Позиція замовлення",
    changes: [
      { label: "Назва", before: "Доставка по Києву", after: null },
      { label: "Ціна", before: "150 ₴", after: null },
    ],
  }),
];

const PAGE: AuditPage = { items: PREVIEW_AUDIT_ENTRIES, hasMore: true };

interface AuditPreviewProps {
  screen: AuditPreviewScreen;
  loadMore: () => Promise<LoadMoreAuditResult>;
}

export default function AuditPreview({ screen, loadMore }: AuditPreviewProps) {
  return (
    <AuditPageContent
      page={screen === "audit-empty" ? { items: [], hasMore: false } : PAGE}
      filters={parseAuditParams({})}
      actors={[
        { id: "u1", name: "Олена Коваль" },
        { id: "u2", name: "Андрій Старший" },
      ]}
      loadMore={loadMore}
    />
  );
}
