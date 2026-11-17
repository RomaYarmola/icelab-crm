import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { confirmDraftAction, rejectDraftAction } from "@/app/(app)/orders/draft-actions";
import DraftsContent from "@/components/draftsPage/DraftsContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { listIntakeDrafts } from "@/server/intake/drafts";
import { getLocationFilter } from "@/server/location-filter";

export const metadata: Metadata = { title: "Чернетки" };

/**
 * «Чернетки» (ТЗ 6.9): заявки з Telegram і сайту, що чекають підтвердження. Лише власник і менеджер;
 * локація з вибору в шапці звужує список. Доступ до розділу замовлень закриває layout.
 */
export default async function DraftsPage() {
  const user = await requireUser();
  if (user.role !== "owner" && user.role !== "manager") redirect("/orders");
  const location = await getLocationFilter();
  const drafts = await listIntakeDrafts(getDb(), user, {
    locationId: location.selectedId ?? undefined,
  });
  return (
    <DraftsContent
      drafts={drafts}
      actions={{ confirm: confirmDraftAction, reject: rejectDraftAction }}
    />
  );
}
