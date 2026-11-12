"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect, { type SelectOption } from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface PriceChangeFormProps {
  action: FormAction;
  /** Ціна клієнта: чий це клієнт (приховане поле `clientId`). */
  clientId?: string;
  /** Прайс: тип льоду вже відомий (приховане поле), вибирати його не треба. */
  fixedIceTypeId?: string;
  /** Ціна клієнта: типи льоду для вибору (разом із «для будь-якого типу»). */
  iceTypeOptions?: SelectOption[];
  /** Сьогоднішня дата `YYYY-MM-DD`: початкове значення дати. */
  today: string;
  submitLabel?: string;
}

/**
 * Форма «нова ціна від дати» (D45) для ціни клієнта і для прайсу. Стара ціна закривається днем
 * перед новою датою, нова починає діяти з вибраної дати (можна майбутню), історія лишається.
 */
export default function PriceChangeForm({
  action,
  clientId,
  fixedIceTypeId,
  iceTypeOptions,
  today,
  submitLabel = "Зберегти ціну",
}: PriceChangeFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { iceTypeId: "", pricePerKg: "", validFrom: today, ...state.values };

  return (
    <Form action={formAction}>
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
      {fixedIceTypeId ? <input type="hidden" name="iceTypeId" value={fixedIceTypeId} /> : null}
      {iceTypeOptions ? (
        <CustomizedSelect
          name="iceTypeId"
          label="Тип льоду"
          options={iceTypeOptions}
          defaultValue={values.iceTypeId}
        />
      ) : null}
      <CustomizedInput
        name="pricePerKg"
        label="Ціна, ₴/кг"
        inputMode="decimal"
        autoComplete="off"
        placeholder="75"
        defaultValue={values.pricePerKg}
        required
      />
      <CustomizedInput
        name="validFrom"
        type="date"
        label="Діє з дати"
        defaultValue={values.validFrom}
        hint="Стара ціна закриється днем раніше, історія збережеться. Можна вказати майбутню дату."
        required
      />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        {submitLabel}
      </MainButton>
    </Form>
  );
}
