import type { Metadata } from "next";
import { loadMoreAuditAction } from "@/app/(app)/more/audit/actions";
import AuditPageContent from "@/components/auditPage/AuditPageContent";
import { getDb } from "@/db/client";
import { listAuditActors, listAuditEntries } from "@/server/audit";
import { requirePageUser } from "@/server/page-access";
import { parseAuditParams, toAuditQuery } from "@/utils/auditParams";

export const metadata: Metadata = { title: "Журнал змін" };

/**
 * Журнал змін: розділ, користувач, дні й пошук беремо з адреси сторінки. Лише читання, його бачать
 * власник і бухгалтер. Доступ до розділу закривають layout і `requirePageUser`, право на дані перевіряє
 * `listAuditEntries`.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseAuditParams(await searchParams);
  // Layout і сторінка рендеряться паралельно: без цієї перевірки заборонена роль встигла б дійти до
  // читання даних і кинути ForbiddenError у лог, хоча переходить на свою сторінку.
  const user = await requirePageUser("audit");
  const db = getDb();
  const [page, actors] = await Promise.all([
    listAuditEntries(db, user, toAuditQuery(filters)),
    listAuditActors(db, user),
  ]);

  return (
    <AuditPageContent
      page={page}
      filters={filters}
      actors={actors}
      loadMore={loadMoreAuditAction}
    />
  );
}
