import type { Metadata } from "next";
import AnalyticsContent from "@/components/analyticsPage/AnalyticsContent";
import { getDb } from "@/db/client";
import { getAnalytics } from "@/server/analytics";
import { getLocationFilter } from "@/server/location-filter";
import { requirePageUser } from "@/server/page-access";
import { parseAnalyticsParams } from "@/utils/analyticsParams";
import { todayIso } from "@/utils/isoDate";

export const metadata: Metadata = { title: "Аналітика" };

/** Панель аналітики (B14, ТЗ 6.11): період в адресі, локація з вибору в шапці. */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("analytics");
  const period = parseAnalyticsParams(await searchParams, todayIso());
  const location = await getLocationFilter();
  const data = await getAnalytics(getDb(), user, { ...period, locationId: location.selectedId });
  return <AnalyticsContent data={data} />;
}
