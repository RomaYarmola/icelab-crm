"use client";

import { useActionState, useState } from "react";
import { ADDRESS_KIND_LABELS, type AddressKindValue } from "@/constants/clients";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import Checkbox from "../shared/customizedInput/Checkbox";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import type { FormAction } from "./clientActions";

export interface AddressFormDefaults {
  kind: AddressKindValue;
  label: string;
  cityText: string;
  addressText: string;
  recipientName: string;
  npWarehouseNumber: string;
  timeWindow: string;
  isDefault: boolean;
}

interface AddressFormProps {
  mode: "add" | "edit";
  clientId?: string;
  addressId?: string;
  defaults: AddressFormDefaults;
  action: FormAction;
  submitLabel: string;
}

const KIND_OPTIONS = Object.entries(ADDRESS_KIND_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/**
 * Форма адреси: вид (доставка, склад чи адреса Нової Пошти, автобус), місто, адреса, отримувач.
 * Номер відділення з'являється лише для складу Нової Пошти. Адреса за замовчуванням одна.
 * Реквізити Нової Пошти тут лише текст: зіставлення з довідниками робить блок B10.
 */
export default function AddressForm({
  mode,
  clientId,
  addressId,
  defaults,
  action,
  submitLabel,
}: AddressFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { ...defaults, ...state.values };
  const [kind, setKind] = useState<string>(values.kind);

  return (
    <Form action={formAction}>
      {mode === "add" ? <input type="hidden" name="clientId" value={clientId} /> : null}
      {mode === "edit" ? <input type="hidden" name="id" value={addressId} /> : null}
      <CustomizedSelect
        name="kind"
        label="Вид адреси"
        options={KIND_OPTIONS}
        value={kind}
        onChange={(event) => setKind(event.target.value)}
      />
      <CustomizedInput
        name="label"
        label="Назва адреси"
        autoComplete="off"
        defaultValue={values.label}
        hint="Необов'язково: наприклад, «Склад» чи «Офіс»."
      />
      <CustomizedInput
        name="cityText"
        label="Місто"
        autoComplete="off"
        defaultValue={values.cityText}
      />
      <CustomizedInput
        name="addressText"
        label="Адреса"
        as="textarea"
        defaultValue={values.addressText}
        hint="Вулиця, будинок, орієнтири."
      />
      {kind === "np_warehouse" ? (
        <CustomizedInput
          name="npWarehouseNumber"
          label="Номер відділення"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={values.npWarehouseNumber}
        />
      ) : null}
      <CustomizedInput
        name="recipientName"
        label="Отримувач"
        autoComplete="off"
        defaultValue={values.recipientName}
        hint="Необов'язково: хто забирає."
      />
      <CustomizedInput
        name="timeWindow"
        label="Вікно доставки"
        autoComplete="off"
        defaultValue={values.timeWindow}
        hint="Необов'язково: наприклад, 10:00-14:00."
      />
      <Checkbox
        name="isDefault"
        label="Адреса за замовчуванням"
        defaultChecked={defaults.isDefault}
        hint="Підставляється в нове замовлення."
      />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        {submitLabel}
      </MainButton>
    </Form>
  );
}
