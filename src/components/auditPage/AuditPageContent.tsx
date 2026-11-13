import type { LoadMoreAuditResult } from "@/app/(app)/more/audit/actions";
import type { AuditPage } from "@/server/audit";
import {
  type AuditListFilters,
  countActiveAuditFilters,
  hasActiveAuditSearch,
  toAuditQuery,
} from "@/utils/auditParams";
import EmptyState from "../shared/emptyState/EmptyState";
import HistoryIcon from "../shared/icons/HistoryIcon";
import BackLink from "../shared/links/BackLink";
import SearchField from "../shared/search/SearchField";
import Text from "../shared/texts/Text";
import AuditFilters from "./AuditFilters";
import AuditList from "./AuditList";

interface AuditPageContentProps {
  page: AuditPage;
  filters: AuditListFilters;
  actors: { id: string; name: string }[];
  loadMore: (
    query: ReturnType<typeof toAuditQuery> & { offset: number },
  ) => Promise<LoadMoreAuditResult>;
}

/**
 * Екран «Журнал змін» (B8, D89): хто, коли й що змінив. Пошук за номером замовлення чи кодом клієнта,
 * фільтри за розділом, користувачем і днями, записи частинами. Лише читання, його бачать власник і
 * бухгалтер.
 */
export default function AuditPageContent({
  page,
  filters,
  actors,
  loadMore,
}: AuditPageContentProps) {
  const isFiltered = hasActiveAuditSearch(filters);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <BackLink href="/more">Профіль</BackLink>
      <Text variant="muted">
        Усі зміни в системі: хто, коли й що змінив. Шукайте за номером замовлення чи кодом клієнта.
        Журнал веде сама база, його не можна ні змінити, ні стерти.
      </Text>
      <SearchField label="Пошук у журналі" placeholder="№ замовлення або код" />
      <AuditFilters
        actors={actors}
        activeCount={countActiveAuditFilters(filters)}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
      />
      <AuditList
        // Новий пошук чи фільтр: список починається спочатку, довантажені раніше записи зникають.
        key={JSON.stringify(filters)}
        initialItems={page.items}
        initialHasMore={page.hasMore}
        filters={filters}
        loadMore={loadMore}
        empty={
          <EmptyState
            icon={<HistoryIcon />}
            title={isFiltered ? "Нічого не знайдено" : "Змін ще немає"}
            description={
              isFiltered
                ? "Спробуйте інший день, розділ, номер чи код або приберіть фільтри."
                : "Записи з'являться, щойно хтось щось змінить."
            }
          />
        }
      />
    </div>
  );
}
