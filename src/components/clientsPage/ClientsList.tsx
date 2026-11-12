"use client";

import { ReactNode, useState, useTransition } from "react";
import type { LoadMoreResult } from "@/app/(app)/clients/actions";
import type { ClientListItem } from "@/server/client-views";
import type { ClientListFilters } from "@/utils/clientListParams";
import LoadMoreButton from "../shared/buttons/LoadMoreButton";
import Notification from "../shared/notification/Notification";
import ClientListRow from "./ClientListRow";

interface ClientsListProps {
  initialItems: ClientListItem[];
  initialHasMore: boolean;
  /** Пошук і фільтри, з якими сторінка отримала перші клієнти: далі довантажуємо з тими самими. */
  filters: ClientListFilters;
  loadMore: (query: {
    search?: string;
    statusId?: string;
    managerId?: string;
    applicationId?: string;
    includeDeleted?: boolean;
    offset: number;
  }) => Promise<LoadMoreResult>;
  /** Що показати, коли клієнтів немає («Клієнтів ще немає» або «Нічого не знайдено»). */
  empty: ReactNode;
}

/**
 * Список клієнтів частинами (D47): перші 30 приходять зі сторінки, решта довантажується кнопкою
 * «Показати ще». Сторінка ставить `key` за фільтрами, тож при новому пошуку список починається
 * спочатку.
 */
export default function ClientsList({
  initialItems,
  initialHasMore,
  filters,
  loadMore,
  empty,
}: ClientsListProps) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) return <>{empty}</>;

  function showMore() {
    setError(null);
    startTransition(async () => {
      const result = await loadMore({
        search: filters.search || undefined,
        statusId: filters.statusId || undefined,
        managerId: filters.managerId || undefined,
        applicationId: filters.applicationId || undefined,
        includeDeleted: filters.includeDeleted || undefined,
        offset: items.length,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Між запитами могли додати клієнта і зсунути список: однакових не дублюємо.
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
        {items.map((client) => (
          <ClientListRow key={client.id} client={client} />
        ))}
      </ul>
      {error ? <Notification variant="error">{error}</Notification> : null}
      {hasMore ? <LoadMoreButton onClick={showMore} isLoading={isPending} /> : null}
    </div>
  );
}
