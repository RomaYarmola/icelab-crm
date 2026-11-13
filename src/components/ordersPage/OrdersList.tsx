"use client";

import { ReactNode, useState, useTransition } from "react";
import type { LoadMoreOrdersResult } from "@/app/(app)/orders/actions";
import type { OrderListItem } from "@/server/order-views";
import type { OrderListFilters } from "@/utils/orderListParams";
import LoadMoreButton from "../shared/buttons/LoadMoreButton";
import Notification from "../shared/notification/Notification";
import OrderListRow from "./OrderListRow";

interface OrdersListProps {
  initialItems: OrderListItem[];
  initialHasMore: boolean;
  /** Пошук і фільтри, з якими сторінка отримала перші замовлення: далі довантажуємо з тими самими. */
  filters: OrderListFilters;
  /** Локація з вибору в шапці (`undefined`: усі). */
  locationId?: string;
  loadMore: (query: {
    dateFrom?: string;
    dateTo?: string;
    statuses?: string[];
    managerId?: string;
    deliveryMethod?: string;
    locationId?: string;
    search?: string;
    offset: number;
  }) => Promise<LoadMoreOrdersResult>;
  /** Що показати, коли замовлень немає («Замовлень ще немає» або «Нічого не знайдено»). */
  empty: ReactNode;
}

/**
 * Список замовлень частинами (по 30): перші приходять зі сторінки, решта довантажується кнопкою
 * «Показати ще». Сторінка ставить `key` за фільтрами, тож при новому пошуку список починається
 * спочатку.
 */
export default function OrdersList({
  initialItems,
  initialHasMore,
  filters,
  locationId,
  loadMore,
  empty,
}: OrdersListProps) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) return <>{empty}</>;

  // Дату показуємо, лише коли список охоплює більше одного дня.
  const showDate = filters.dateFrom !== filters.dateTo || filters.dateFrom === "";

  function showMore() {
    setError(null);
    startTransition(async () => {
      const result = await loadMore({
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        statuses: filters.status ? [filters.status] : undefined,
        managerId: filters.managerId || undefined,
        deliveryMethod: filters.deliveryMethod || undefined,
        locationId,
        search: filters.search || undefined,
        offset: items.length,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Між запитами могли додати замовлення і зсунути список: однакових не дублюємо.
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.page.items.filter((item) => !seen.has(item.id))];
      });
      setHasMore(result.page.hasMore);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3 lg:grid-cols-2">
        {items.map((order) => (
          <OrderListRow key={order.id} order={order} showDate={showDate} />
        ))}
      </ul>
      {error ? <Notification variant="error">{error}</Notification> : null}
      {hasMore ? <LoadMoreButton onClick={showMore} isLoading={isPending} /> : null}
    </div>
  );
}
