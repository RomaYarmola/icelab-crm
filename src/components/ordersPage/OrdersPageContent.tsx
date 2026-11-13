import type { LoadMoreOrdersResult } from "@/app/(app)/orders/actions";
import type { OrderListPage } from "@/server/orders";
import {
  countActiveFilters,
  hasActiveSearch,
  type OrderListFilters,
} from "@/utils/orderListParams";
import ButtonLink from "../shared/buttons/ButtonLink";
import EmptyState from "../shared/emptyState/EmptyState";
import ExportButton from "../shared/export/ExportButton";
import OrdersIcon from "../shared/icons/OrdersIcon";
import SearchField from "../shared/search/SearchField";
import DayChips from "./DayChips";
import OrderFilters from "./OrderFilters";
import OrdersList from "./OrdersList";

interface OrdersPageContentProps {
  page: OrderListPage;
  filters: OrderListFilters;
  managers: { id: string; name: string }[];
  /** Локація з вибору в шапці (`undefined`: усі). */
  locationId?: string;
  /** Власник і менеджер створюють замовлення. Кнопка з'являється разом із формою (PR 3). */
  canCreate: boolean;
  /** Є право на експорт у Excel (власник, менеджер, бухгалтер, D92). */
  canExport: boolean;
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
}

/**
 * Екран «Замовлення»: дні, пошук (клієнт чи номер), фільтри й список частинами. Кнопка «Нове
 * замовлення» є лише там, де є форма створення.
 */
export default function OrdersPageContent({
  page,
  filters,
  managers,
  locationId,
  canCreate,
  canExport,
  loadMore,
}: OrdersPageContentProps) {
  const isFiltered = hasActiveSearch(filters);
  const newOrderButton = canCreate ? (
    <ButtonLink href="/orders/new" className="w-full lg:w-auto">
      Нове замовлення
    </ButtonLink>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Кнопка першою в розмітці (на телефоні над пошуком), на комп'ютері справа від нього. */}
      <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-start">
        {newOrderButton}
        <div className="flex-1">
          <SearchField label="Пошук замовлень" placeholder="Клієнт, код, телефон або номер" />
        </div>
      </div>
      <DayChips day={filters.day} dateFrom={filters.dateFrom} dateTo={filters.dateTo} />
      <OrderFilters managers={managers} activeCount={countActiveFilters(filters)} />
      {canExport ? <ExportButton list="orders" className="w-full lg:w-auto" /> : null}
      <OrdersList
        // Новий пошук чи фільтр: список починається спочатку, довантажені раніше замовлення зникають.
        key={JSON.stringify([filters, locationId])}
        initialItems={page.items}
        initialHasMore={page.hasMore}
        filters={filters}
        locationId={locationId}
        loadMore={loadMore}
        empty={
          isFiltered ? (
            <EmptyState
              icon={<OrdersIcon />}
              title="Нічого не знайдено"
              description="Спробуйте інший день, клієнта чи номер або приберіть фільтри."
            />
          ) : (
            <EmptyState
              icon={<OrdersIcon />}
              title="Замовлень на цей день немає"
              description={
                canCreate
                  ? "Створіть замовлення або оберіть інший день."
                  : "Оберіть інший день: замовлення з'являться тут."
              }
              action={
                canCreate ? <ButtonLink href="/orders/new">Нове замовлення</ButtonLink> : undefined
              }
            />
          )
        }
      />
    </div>
  );
}
