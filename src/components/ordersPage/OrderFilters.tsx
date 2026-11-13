import {
  DELIVERY_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_ORDER,
} from "@/constants/orders";
import { ORDER_LIST_PARAMS } from "@/utils/orderListParams";
import Disclosure from "../shared/disclosure/Disclosure";
import FilterSelect from "../shared/search/FilterSelect";

interface OrderFiltersProps {
  managers: { id: string; name: string }[];
  /** Скільки фільтрів увімкнено: від цього залежить підпис і те, чи блок розкрито. */
  activeCount: number;
}

const STATUS_OPTIONS = ORDER_STATUS_ORDER.map((status) => ({
  value: status,
  label: ORDER_STATUS_LABELS[status],
}));

const DELIVERY_OPTIONS = Object.entries(DELIVERY_METHOD_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Фільтри списку замовлень за статусом, менеджером клієнта й способом доставки, згорнуті в один блок. */
export default function OrderFilters({ managers, activeCount }: OrderFiltersProps) {
  return (
    <Disclosure
      summary={activeCount > 0 ? `Фільтри · ${activeCount}` : "Фільтри"}
      defaultOpen={activeCount > 0}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <FilterSelect
          paramName={ORDER_LIST_PARAMS.status}
          label="Статус"
          allLabel="Усі статуси"
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          paramName={ORDER_LIST_PARAMS.manager}
          label="Менеджер клієнта"
          allLabel="Усі менеджери"
          options={managers.map((manager) => ({ value: manager.id, label: manager.name }))}
        />
        <FilterSelect
          paramName={ORDER_LIST_PARAMS.delivery}
          label="Спосіб доставки"
          allLabel="Усі способи"
          options={DELIVERY_OPTIONS}
        />
      </div>
    </Disclosure>
  );
}
