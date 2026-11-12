import { CLIENT_LIST_PARAMS } from "@/utils/clientListParams";
import Disclosure from "../shared/disclosure/Disclosure";
import FilterSelect from "../shared/search/FilterSelect";
import DeletedToggle from "./DeletedToggle";

interface Option {
  id: string;
  name: string;
}

interface ClientFiltersProps {
  statuses: Option[];
  managers: Option[];
  applications: Option[];
  /** Скільки фільтрів увімкнено: від цього залежить підпис і те, чи блок розкрито. */
  activeCount: number;
  /** Лише власник бачить видалених клієнтів. */
  canSeeDeleted: boolean;
}

const toOptions = (list: Option[]) => list.map((item) => ({ value: item.id, label: item.name }));

/** Фільтри списку клієнтів за статусом, менеджером і застосуванням, згорнуті в один блок. */
export default function ClientFilters({
  statuses,
  managers,
  applications,
  activeCount,
  canSeeDeleted,
}: ClientFiltersProps) {
  return (
    <Disclosure
      summary={activeCount > 0 ? `Фільтри · ${activeCount}` : "Фільтри"}
      defaultOpen={activeCount > 0}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <FilterSelect
          paramName={CLIENT_LIST_PARAMS.status}
          label="Статус"
          allLabel="Усі статуси"
          options={toOptions(statuses)}
        />
        <FilterSelect
          paramName={CLIENT_LIST_PARAMS.manager}
          label="Менеджер"
          allLabel="Усі менеджери"
          options={toOptions(managers)}
        />
        <FilterSelect
          paramName={CLIENT_LIST_PARAMS.application}
          label="Застосування"
          allLabel="Усі застосування"
          options={toOptions(applications)}
        />
        {canSeeDeleted ? <DeletedToggle /> : null}
      </div>
    </Disclosure>
  );
}
