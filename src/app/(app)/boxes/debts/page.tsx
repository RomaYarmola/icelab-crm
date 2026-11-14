import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveLegacyDebtAction } from "@/app/(app)/boxes/actions";
import BoxDebtsContent from "@/components/boxesPage/BoxDebtsContent";
import { getDb } from "@/db/client";
import { listBoxDebts, listLegacyDebts } from "@/server/box-debts";
import { can } from "@/server/permissions";
import { requirePageUser } from "@/server/page-access";

export const metadata: Metadata = { title: "Борги по боксах" };

/** Борги по боксах (D113). Виробництво боргів не бачить: його екран це сканер. */
export default async function BoxDebtsPage() {
  const user = await requirePageUser("boxes");
  if (user.role === "production") redirect("/scan");
  const db = getDb();
  const [rows, legacy] = await Promise.all([listBoxDebts(db, user), listLegacyDebts(db, user)]);
  return (
    <BoxDebtsContent
      rows={rows}
      legacy={legacy}
      showRegistry={user.role === "owner" || user.role === "location_lead"}
      canResolve={user.role === "owner" || user.role === "location_lead"}
      resolveAction={resolveLegacyDebtAction}
      canExport={can(user.role, "excel_export", "write")}
    />
  );
}
