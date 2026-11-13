"use client";

import { AUDIT_SECTION_ORDER, AUDIT_SECTIONS } from "@/server/audit-labels";
import { AUDIT_PARAMS } from "@/utils/auditParams";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import FilterSelect from "../shared/search/FilterSelect";
import { useUrlParams } from "../shared/search/useUrlParams";

interface AuditFiltersProps {
  actors: { id: string; name: string }[];
  /** Скільки фільтрів увімкнено: від цього залежить підпис і те, чи блок розкрито. */
  activeCount: number;
  dateFrom: string;
  dateTo: string;
}

const SECTION_OPTIONS = AUDIT_SECTION_ORDER.map((section) => ({
  value: section,
  label: AUDIT_SECTIONS[section],
}));

/** Фільтри журналу: розділ, користувач і два дні (за київським часом). Стан у адресі сторінки. */
export default function AuditFilters({ actors, activeCount, dateFrom, dateTo }: AuditFiltersProps) {
  const { update } = useUrlParams();
  return (
    <Disclosure
      summary={activeCount > 0 ? `Фільтри · ${activeCount}` : "Фільтри"}
      defaultOpen={activeCount > 0}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FilterSelect
          paramName={AUDIT_PARAMS.section}
          label="Розділ"
          allLabel="Усі розділи"
          options={SECTION_OPTIONS}
        />
        <FilterSelect
          paramName={AUDIT_PARAMS.actor}
          label="Користувач"
          allLabel="Усі користувачі"
          options={actors.map((actor) => ({ value: actor.id, label: actor.name }))}
        />
        <CustomizedInput
          name="from"
          type="date"
          label="Від"
          defaultValue={dateFrom}
          onChange={(event) => update({ [AUDIT_PARAMS.from]: event.target.value })}
        />
        <CustomizedInput
          name="to"
          type="date"
          label="До"
          defaultValue={dateTo}
          onChange={(event) => update({ [AUDIT_PARAMS.to]: event.target.value })}
        />
      </div>
    </Disclosure>
  );
}
