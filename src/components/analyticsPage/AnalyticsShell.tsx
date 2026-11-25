import type { ReactNode } from "react";
import { ANALYTICS_PARAMS, type AnalyticsTab } from "@/utils/analyticsParams";
import ExportButton from "../shared/export/ExportButton";
import TabLinks from "../shared/tabs/TabLinks";
import AnalyticsFilters from "./AnalyticsFilters";

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: "panel", label: "Панель" },
  { id: "boxes", label: "Бокси" },
  { id: "delivery", label: "Доставки" },
  { id: "inactive", label: "Давно не замовляли" },
  { id: "reminders", label: "Нагадування" },
];

/** Каркас аналітики: вкладки й вибір періоду (період переходить між вкладками). */
export default function AnalyticsShell({
  tab,
  from,
  to,
  reminderCount = 0,
  children,
}: {
  tab: AnalyticsTab;
  from: string;
  to: string;
  /** Скільки актуальних нагадувань у користувача: число в назві вкладки. */
  reminderCount?: number;
  children: ReactNode;
}) {
  const href = (id: AnalyticsTab) =>
    `/analytics?${new URLSearchParams({
      [ANALYTICS_PARAMS.tab]: id,
      [ANALYTICS_PARAMS.from]: from,
      [ANALYTICS_PARAMS.to]: to,
    })}`;
  return (
    <div className="flex flex-col gap-6">
      <TabLinks
        label="Розділи аналітики"
        activeId={tab}
        items={TABS.map((item) => ({
          ...item,
          label:
            item.id === "reminders" && reminderCount > 0
              ? `${item.label} · ${reminderCount}`
              : item.label,
          href: href(item.id),
        }))}
      />
      {tab === "inactive" || tab === "reminders" ? null : (
        <AnalyticsFilters key={`${from}-${to}`} from={from} to={to} />
      )}
      {tab === "reminders" ? null : (
        <ExportButton list="analytics" hint="Файл Excel з тим, що на цій вкладці.">
          Експорт у Excel
        </ExportButton>
      )}
      {children}
    </div>
  );
}
