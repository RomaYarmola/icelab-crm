import type { Metadata } from "next";
import BoxReturnsContent from "@/components/boxesPage/BoxReturnsContent";
import { getDb } from "@/db/client";
import { getLocationFilter } from "@/server/location-filter";
import { listPostReturns } from "@/server/np/return-list";
import { requirePageUser } from "@/server/page-access";
import { can } from "@/server/permissions";

export const metadata: Metadata = { title: "Чекають на пошті" };

/** Повернення боксів Новою Поштою (B17). Вибір локації в шапці звужує список. */
export default async function BoxReturnsPage() {
  const user = await requirePageUser("boxes");
  const location = await getLocationFilter();
  const groups = await listPostReturns(getDb(), user, {
    locationId: location.selectedId ?? undefined,
  });
  return (
    <BoxReturnsContent
      groups={groups}
      showRegistry={user.role === "owner" || user.role === "location_lead"}
      production={user.role === "production"}
      canOpenClient={can(user.role, "clients", "read")}
    />
  );
}
