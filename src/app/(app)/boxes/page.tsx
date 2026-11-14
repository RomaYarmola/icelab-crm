import type { Metadata } from "next";
import BoxesPageContent from "@/components/boxesPage/BoxesPageContent";
import BoxIcon from "@/components/shared/icons/BoxIcon";
import PlaceholderPage from "@/components/shared/placeholderPage/PlaceholderPage";
import { getDb } from "@/db/client";
import { listBoxes, listBoxTypeOptions } from "@/server/boxes";
import { getLocationFilter } from "@/server/location-filter";
import { requirePageUser } from "@/server/page-access";
import { redirect } from "next/navigation";
import { parseBoxListParams } from "@/utils/boxListParams";

export const metadata: Metadata = { title: "Бокси" };

/**
 * Реєстр боксів для власника й старшого локації (B9, ТЗ 6.7). Вибір локації в шапці звужує список
 * (старший локації бачить лише свою). Іншим ролям розділ поки порожній: сканер буде в PR 3.
 */
export default async function BoxesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("boxes");
  // Виробництво працює зі сканером; реєстр лише для власника й старшого локації.
  if (user.role === "production") redirect("/scan");
  if (user.role !== "owner" && user.role !== "location_lead") {
    return <PlaceholderPage icon={<BoxIcon />} title="Тут буде облік боксів" />;
  }
  const filters = parseBoxListParams(await searchParams);
  const location = await getLocationFilter();
  const db = getDb();
  const [page, types] = await Promise.all([
    listBoxes(db, user, {
      status: filters.status || undefined,
      boxTypeId: filters.boxTypeId || undefined,
      search: filters.search || undefined,
      locationId: location.selectedId ?? undefined,
      limit: filters.shown,
    }),
    listBoxTypeOptions(db),
  ]);
  return (
    <BoxesPageContent
      items={page.items}
      hasMore={page.hasMore}
      filters={filters}
      types={types}
      showLocation={user.role === "owner"}
    />
  );
}
