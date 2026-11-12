import type { Metadata } from "next";
import { loadMoreClientsAction } from "@/app/(app)/clients/actions";
import ClientsPageContent from "@/components/clientsPage/ClientsPageContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getClientFormOptions } from "@/server/client-options";
import { listClients } from "@/server/clients";
import { can } from "@/server/permissions";
import { parseClientListParams } from "@/utils/clientListParams";

export const metadata: Metadata = { title: "Клієнти" };

/** Список клієнтів: пошук і фільтри беремо з адреси сторінки (D47). Доступ закриває layout розділу. */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseClientListParams(await searchParams);
  const user = await requireUser();
  const db = getDb();
  const [page, options] = await Promise.all([
    listClients(db, user, {
      search: filters.search,
      statusId: filters.statusId || undefined,
      managerId: filters.managerId || undefined,
      applicationId: filters.applicationId || undefined,
      includeDeleted: filters.includeDeleted,
    }),
    getClientFormOptions(db, user),
  ]);

  return (
    <ClientsPageContent
      page={page}
      filters={{ ...filters, includeDeleted: filters.includeDeleted && user.role === "owner" }}
      options={options}
      canCreate={can(user.role, "clients", "write")}
      canSeeDeleted={user.role === "owner"}
      loadMore={loadMoreClientsAction}
    />
  );
}
