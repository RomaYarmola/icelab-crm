import type { Metadata } from "next";
import { redirect } from "next/navigation";
import BoxStockContent from "@/components/boxesPage/BoxStockContent";
import { getDb } from "@/db/client";
import { listBoxStock } from "@/server/box-debts";
import { getLocationFilter } from "@/server/location-filter";
import { can } from "@/server/permissions";
import { requirePageUser } from "@/server/page-access";

export const metadata: Metadata = { title: "Склад боксів" };

/** Склад боксів по локаціях і типах. Вибір локації в шапці звужує список. */
export default async function BoxStockPage() {
  const user = await requirePageUser("boxes");
  if (user.role === "production") redirect("/scan");
  const location = await getLocationFilter();
  const rows = await listBoxStock(getDb(), user, { locationId: location.selectedId ?? undefined });
  return (
    <BoxStockContent
      rows={rows}
      showRegistry={user.role === "owner" || user.role === "location_lead"}
      canExport={can(user.role, "excel_export", "write")}
      showLocation={user.role === "owner" || user.role === "manager" || user.role === "accountant"}
    />
  );
}
