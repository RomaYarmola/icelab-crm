import type { Metadata } from "next";
import { createShipmentStepAction } from "@/app/(app)/shipments/actions";
import ShipmentDayContent from "@/components/shipmentsPage/ShipmentDayContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getLocationFilter } from "@/server/location-filter";
import { can } from "@/server/permissions";
import { listShipmentDay } from "@/server/np/shipment-day";
import { todayIso } from "@/utils/isoDate";
import { parseDayParam } from "@/utils/productionParams";

export const metadata: Metadata = { title: "ТТН на день" };

/**
 * «ТТН на день» (ТЗ 6.8): замовлення Нової Пошти на дату з адресою, вагою й тим, чого бракує.
 * День з адреси (`?date=`), локація з вибору в шапці (старший локації бачить лише свою).
 */
export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const today = todayIso();
  const date = parseDayParam(await searchParams, today);
  const location = await getLocationFilter();
  const day = await listShipmentDay(getDb(), user, {
    date,
    locationId: location.selectedId ?? undefined,
  });
  return (
    <ShipmentDayContent
      day={day}
      today={today}
      actions={{ createStep: createShipmentStepAction }}
      canExport={can(user.role, "excel_export", "write")}
    />
  );
}
