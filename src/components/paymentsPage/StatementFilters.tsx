"use client";

import { PAYMENT_PARAMS, type PaymentParams } from "@/utils/paymentParams";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import FilterSelect from "../shared/search/FilterSelect";
import { useUrlParams } from "../shared/search/useUrlParams";

interface StatementFiltersProps {
  statusOptions: { value: string; label: string }[];
  activeCount: number;
  params: PaymentParams;
}

/** Фільтри виписки: статус зіставлення, два дні (за Києвом) і сума від-до. Стан у адресі сторінки. */
export default function StatementFilters({
  statusOptions,
  activeCount,
  params,
}: StatementFiltersProps) {
  const { update } = useUrlParams();
  return (
    <Disclosure
      summary={activeCount > 0 ? `Фільтри · ${activeCount}` : "Фільтри"}
      defaultOpen={activeCount > 0}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FilterSelect
          paramName={PAYMENT_PARAMS.status}
          label="Статус"
          allLabel="Усі статуси"
          options={statusOptions}
        />
        <span className="hidden sm:block" />
        <CustomizedInput
          name="from"
          type="date"
          label="Від"
          defaultValue={params.from ?? ""}
          onChange={(event) => update({ [PAYMENT_PARAMS.from]: event.target.value })}
        />
        <CustomizedInput
          name="to"
          type="date"
          label="До"
          defaultValue={params.to ?? ""}
          onChange={(event) => update({ [PAYMENT_PARAMS.to]: event.target.value })}
        />
        <CustomizedInput
          name="min"
          label="Сума від, ₴"
          inputMode="decimal"
          defaultValue={params.min !== null ? String(params.min) : ""}
          onChange={(event) => update({ [PAYMENT_PARAMS.min]: event.target.value })}
        />
        <CustomizedInput
          name="max"
          label="Сума до, ₴"
          inputMode="decimal"
          defaultValue={params.max !== null ? String(params.max) : ""}
          onChange={(event) => update({ [PAYMENT_PARAMS.max]: event.target.value })}
        />
      </div>
    </Disclosure>
  );
}
