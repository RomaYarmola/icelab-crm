import type { LoadMoreResult } from "@/app/(app)/clients/actions";
import type { ClientListPage } from "@/server/clients";
import type { ClientFormOptions } from "@/server/client-options";
import {
  type ClientListFilters,
  countActiveFilters,
  hasActiveSearch,
} from "@/utils/clientListParams";
import { INLINE_HINTS } from "@/constants/hints";
import ButtonLink from "../shared/buttons/ButtonLink";
import EmptyState from "../shared/emptyState/EmptyState";
import ExportButton from "../shared/export/ExportButton";
import ClientsIcon from "../shared/icons/ClientsIcon";
import SearchField from "../shared/search/SearchField";
import ClientFilters from "./ClientFilters";
import ClientsList from "./ClientsList";

interface ClientsPageContentProps {
  page: ClientListPage;
  filters: ClientListFilters;
  options: Pick<ClientFormOptions, "statuses" | "managers" | "applications">;
  /** Менеджер і власник створюють клієнтів, решта лише дивиться. */
  canCreate: boolean;
  canSeeDeleted: boolean;
  /** Є право на експорт у Excel (власник, менеджер, бухгалтер, D92). */
  canExport: boolean;
  loadMore: (query: {
    search?: string;
    statusId?: string;
    managerId?: string;
    applicationId?: string;
    includeDeleted?: boolean;
    offset: number;
  }) => Promise<LoadMoreResult>;
}

/** Екран «Клієнти»: пошук, фільтри, список частинами і «Новий клієнт» (для тих, хто може). */
export default function ClientsPageContent({
  page,
  filters,
  options,
  canCreate,
  canSeeDeleted,
  canExport,
  loadMore,
}: ClientsPageContentProps) {
  const isFiltered = hasActiveSearch(filters);
  const newClientButton = canCreate ? (
    <ButtonLink href="/clients/new" className="w-full lg:w-auto">
      Новий клієнт
    </ButtonLink>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Кнопка першою в розмітці (на телефоні над пошуком), на комп'ютері справа від нього. */}
      <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-start">
        {newClientButton}
        <div className="flex-1">
          <SearchField label="Пошук клієнтів" placeholder="Код, назва, телефон або контакт" />
        </div>
      </div>
      <ClientFilters
        statuses={options.statuses}
        managers={options.managers}
        applications={options.applications}
        activeCount={countActiveFilters(filters)}
        canSeeDeleted={canSeeDeleted}
      />
      {canExport ? (
        <ExportButton
          list="clients"
          hint={INLINE_HINTS.exportClients}
          className="w-full lg:w-auto"
        />
      ) : null}
      <ClientsList
        // Новий пошук чи фільтр: список починається спочатку, довантажені раніше клієнти зникають.
        key={JSON.stringify(filters)}
        initialItems={page.items}
        initialHasMore={page.hasMore}
        filters={filters}
        loadMore={loadMore}
        empty={
          isFiltered ? (
            <EmptyState
              icon={<ClientsIcon />}
              title="Нічого не знайдено"
              description="Спробуйте іншу назву, код або номер телефону чи приберіть фільтри."
            />
          ) : (
            <EmptyState
              icon={<ClientsIcon />}
              title="Клієнтів ще немає"
              description={
                canCreate
                  ? "Додайте першого клієнта: код видасться сам."
                  : "Клієнти з'являться тут."
              }
              action={
                canCreate ? <ButtonLink href="/clients/new">Новий клієнт</ButtonLink> : undefined
              }
            />
          )
        }
      />
    </div>
  );
}
