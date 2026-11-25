import type { Metadata } from "next";
import AnalyticsContent from "@/components/analyticsPage/AnalyticsContent";
import AnalyticsShell from "@/components/analyticsPage/AnalyticsShell";
import BoxesContent from "@/components/analyticsPage/BoxesContent";
import DeliveryContent from "@/components/analyticsPage/DeliveryContent";
import { getDb } from "@/db/client";
import { getAnalytics } from "@/server/analytics";
import { getBoxAnalytics, getDeliveryAnalytics } from "@/server/analytics-sales";
import { getLocationFilter } from "@/server/location-filter";
import { requirePageUser } from "@/server/page-access";
import { parseAnalyticsParams, parseAnalyticsTab } from "@/utils/analyticsParams";
import { todayIso } from "@/utils/isoDate";

export const metadata: Metadata = { title: "Аналітика" };

/**
 * Аналітика (B14, ТЗ 6.11): вкладки «Панель», «Бокси», «Доставки». Вкладка й період в адресі,
 * локація з вибору в шапці.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("analytics");
  const raw = await searchParams;
  const tab = parseAnalyticsTab(raw.tab);
  const period = parseAnalyticsParams(raw, todayIso());
  const location = await getLocationFilter();
  const db = getDb();
  const query = { ...period, locationId: location.selectedId };
  return (
    <AnalyticsShell tab={tab} from={period.from} to={period.to}>
      {tab === "boxes" ? (
        <BoxesContent data={await getBoxAnalytics(db, user, query)} />
      ) : tab === "delivery" ? (
        <DeliveryContent data={await getDeliveryAnalytics(db, user, query)} />
      ) : (
        <AnalyticsContent data={await getAnalytics(db, user, query)} />
      )}
    </AnalyticsShell>
  );
}
