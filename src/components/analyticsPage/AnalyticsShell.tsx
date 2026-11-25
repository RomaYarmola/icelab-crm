import type { ReactNode } from "react";
import { ANALYTICS_PARAMS, type AnalyticsTab } from "@/utils/analyticsParams";
import TabLinks from "../shared/tabs/TabLinks";
import AnalyticsFilters from "./AnalyticsFilters";

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: "panel", label: "Панель" },
  { id: "boxes", label: "Бокси" },
  { id: "delivery", label: "Доставки" },
  { id: "inactive", label: "Давно не замовляли" },
];

/** Каркас аналітики: вкладки й вибір періоду (період переходить між вкладками). */
export default function AnalyticsShell({
  tab,
  from,
  to,
  children,
}: {
  tab: AnalyticsTab;
  from: string;
  to: string;
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
        items={TABS.map((item) => ({ ...item, href: href(item.id) }))}
      />
      {tab === "inactive" ? null : <AnalyticsFilters key={`${from}-${to}`} from={from} to={to} />}
      {children}
    </div>
  );
}
