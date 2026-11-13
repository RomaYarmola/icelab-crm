"use client";

import { ReactNode, useState, useTransition } from "react";
import type { LoadMoreAuditResult } from "@/app/(app)/more/audit/actions";
import type { AuditEntryView } from "@/server/audit";
import { type AuditListFilters, toAuditQuery } from "@/utils/auditParams";
import LoadMoreButton from "../shared/buttons/LoadMoreButton";
import Notification from "../shared/notification/Notification";
import AuditEntryCard from "./AuditEntryCard";

interface AuditListProps {
  initialItems: AuditEntryView[];
  initialHasMore: boolean;
  /** Фільтри, з якими сторінка отримала перші записи: далі довантажуємо з тими самими. */
  filters: AuditListFilters;
  loadMore: (
    query: ReturnType<typeof toAuditQuery> & { offset: number },
  ) => Promise<LoadMoreAuditResult>;
  /** Що показати, коли записів немає. */
  empty: ReactNode;
}

/**
 * Журнал частинами (по 30): перші записи приходять зі сторінки, решта довантажується кнопкою «Показати
 * ще». Сторінка ставить `key` за фільтрами, тож при новому пошуку список починається спочатку.
 */
export default function AuditList({
  initialItems,
  initialHasMore,
  filters,
  loadMore,
  empty,
}: AuditListProps) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) return <>{empty}</>;

  function showMore() {
    setError(null);
    startTransition(async () => {
      const result = await loadMore({ ...toAuditQuery(filters), offset: items.length });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Між запитами з'явились нові записи й зсунули список: однакових не дублюємо.
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.page.items.filter((item) => !seen.has(item.id))];
      });
      setHasMore(result.page.hasMore);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {items.map((entry) => (
          <AuditEntryCard key={entry.id} entry={entry} showSubject />
        ))}
      </ul>
      {error ? <Notification variant="error">{error}</Notification> : null}
      {hasMore ? <LoadMoreButton onClick={showMore} isLoading={isPending} /> : null}
    </div>
  );
}
