import type { Metadata } from "next";
import { transitionOrderAction } from "@/app/(app)/orders/actions";
import {
  markAllSeenAction,
  openProductionScreenAction,
  updateProductionOrderAction,
} from "@/app/(app)/production/actions";
import ProductionPageContent from "@/components/productionPage/ProductionPageContent";
import { getDb } from "@/db/client";
import { getLocationFilter } from "@/server/location-filter";
import { requirePageUser } from "@/server/page-access";
import { listProductionQueue } from "@/server/production";
import { getProductionRealtimeConfig } from "@/server/production-signal";
import { todayIso } from "@/utils/isoDate";
import { parseProductionParams } from "@/utils/productionParams";

export const metadata: Metadata = { title: "Виробництво" };

/**
 * Екран виробництва. Бачать власник і менеджер (лише читання, локацію вибирають у шапці), старший
 * локації й виробництво (своя локація, кнопки). Режим «на стіні» лише для старшого локації: день у
 * ньому завжди сьогоднішній. Доступ до розділу закриває `requirePageUser`, дані й права ще раз
 * перевіряє `listProductionQueue`.
 */
export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("production");
  const today = todayIso();
  const params = parseProductionParams(await searchParams, today);
  const locationFilter = await getLocationFilter();

  const isLead = user.role === "location_lead";
  const canWork = isLead || user.role === "production";
  const wall = params.wall && isLead;
  const date = wall ? today : params.date;

  const queue = await listProductionQueue(getDb(), user, {
    date,
    locationId: locationFilter.selectedId ?? undefined,
  });

  // Канали локацій: одна своя, а власник і менеджер без вибору стежать за всіма.
  const watched = queue.locationId
    ? [queue.locationId]
    : locationFilter.options.map((option) => option.id);

  return (
    <ProductionPageContent
      queue={queue}
      today={today}
      wall={wall}
      canWork={canWork}
      canEdit={isLead}
      locationLabel={user.locationName ?? locationFilter.label}
      realtime={getProductionRealtimeConfig(watched)}
      actions={{
        transition: transitionOrderAction,
        updateOrder: updateProductionOrderAction,
        markAllSeen: markAllSeenAction,
        openScreen: openProductionScreenAction,
      }}
    />
  );
}
