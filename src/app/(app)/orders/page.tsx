import type { Metadata } from "next";
import { loadMoreOrdersAction } from "@/app/(app)/orders/actions";
import OrdersPageContent from "@/components/ordersPage/OrdersPageContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getClientFormOptions } from "@/server/client-options";
import { getLocationFilter } from "@/server/location-filter";
import { listOrders } from "@/server/orders";
import { can } from "@/server/permissions";
import { parseOrderListParams } from "@/utils/orderListParams";
import { todayIso } from "@/utils/isoDate";

export const metadata: Metadata = { title: "Замовлення" };

/**
 * Список замовлень: день, фільтри й пошук беремо з адреси сторінки. Локація з вибору в шапці
 * звужує список (роль з локацією бачить лише свою: це робить сам `listOrders`). Доступ до розділу
 * закриває layout.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseOrderListParams(await searchParams, todayIso());
  const user = await requireUser();
  const locationFilter = await getLocationFilter();
  const db = getDb();
  const locationId = locationFilter.selectedId ?? undefined;

  const [page, options] = await Promise.all([
    listOrders(db, user, {
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      statuses: filters.status ? [filters.status as never] : undefined,
      managerId: filters.managerId || undefined,
      deliveryMethod: filters.deliveryMethod || undefined,
      locationId,
      search: filters.search || undefined,
    }),
    getClientFormOptions(db, user),
  ]);

  return (
    <OrdersPageContent
      page={page}
      filters={filters}
      managers={options.managers}
      locationId={locationId}
      // Створюють власник і менеджер (D58); решта бачить список без кнопки.
      canCreate={
        can(user.role, "orders", "write") && (user.role === "owner" || user.role === "manager")
      }
      canExport={can(user.role, "excel_export", "write")}
      loadMore={loadMoreOrdersAction}
    />
  );
}
