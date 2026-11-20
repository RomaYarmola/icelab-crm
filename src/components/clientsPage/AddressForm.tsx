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
import type { FormAction, NpPickerActions } from "./clientActions";
import NpPlaceFields from "./NpPlaceFields";
import PhoneField from "../shared/customizedInput/PhoneField";

export interface AddressFormDefaults {
  kind: AddressKindValue;
  label: string;
  cityText: string;
  addressText: string;
  recipientName: string;
  recipientPhone: string;
  npCityRef: string;
  npWarehouseRef: string;
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
  /** Пошук міст і відділень у довіднику Нової Пошти (підказки). */
  np?: NpPickerActions;
}

/** Види адрес (Роман, 20.11.2026): Нова Пошта (відділення чи кур'єр) і власна доставка; «Автобус» лишається для наявних. */
const SELECTABLE_KINDS: readonly string[] = ["np_warehouse", "np_address", "delivery"];

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
  np,
}: AddressFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { ...defaults, ...state.values };
  const [kind, setKind] = useState<string>(values.kind);
  const isNp = kind === "np_warehouse" || kind === "np_address";
  const withPicker = isNp && np !== undefined;
  // Вибір з довідника повний: без нього адресу Нової Пошти не зберегти.
  const [placeComplete, setPlaceComplete] = useState(false);

  return (
    <Form action={formAction}>
      {mode === "add" ? <input type="hidden" name="clientId" value={clientId} /> : null}
      {mode === "edit" ? <input type="hidden" name="id" value={addressId} /> : null}
      <CustomizedInput
        name="label"
        label="Назва адреси"
        autoComplete="off"
        defaultValue={values.label}
        hint="Обов'язково: наприклад, «Склад» чи «Офіс». Так адреса буде видна в замовленні."
      />
      <CustomizedSelect
        name="kind"
        label="Вид адреси"
        options={Object.entries(ADDRESS_KIND_LABELS)
          .filter(([value]) => SELECTABLE_KINDS.includes(value) || value === defaults.kind)
          .map(([value, label]) => ({ value, label }))}
        value={kind}
        onChange={(event) => setKind(event.target.value)}
      />
      {withPicker ? (
        <NpPlaceFields
          key={kind}
          withWarehouse={kind === "np_warehouse"}
          defaults={{
            cityText: values.cityText,
            cityRef: values.npCityRef,
            warehouseNumber: values.npWarehouseNumber,
            warehouseRef: values.npWarehouseRef,
          }}
          actions={np}
          onComplete={setPlaceComplete}
        />
      ) : (
        <CustomizedInput
          name="cityText"
          label="Місто"
          autoComplete="off"
          defaultValue={values.cityText}
        />
      )}
      {kind !== "np_warehouse" ? (
        <CustomizedInput
          name="addressText"
          label="Адреса"
          as="textarea"
          defaultValue={values.addressText}
          hint={isNp ? "Обов'язково: вулиця й будинок для кур'єра." : "Вулиця, будинок, орієнтири."}
          required={isNp}
        />
      ) : null}
      {kind === "np_warehouse" && !withPicker ? (
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
        hint={isNp ? "Обов'язково: ПІБ, хто забирає посилку." : "Необов'язково: хто забирає."}
        required={isNp}
      />
      <PhoneField
        name="recipientPhone"
        label="Телефон отримувача"
        defaultValue={values.recipientPhone}
        hint={isNp ? "Обов'язково." : "Необов'язково."}
        required={isNp}
      />
      {!isNp ? (
        <CustomizedInput
          name="timeWindow"
          label="Вікно доставки"
          autoComplete="off"
          defaultValue={values.timeWindow}
          hint="Необов'язково: наприклад, 10:00-14:00."
        />
      ) : null}
      <Checkbox
        name="isDefault"
        label="Адреса за замовчуванням"
        defaultChecked={defaults.isDefault}
        hint="Підставляється в нове замовлення."
      />
      <FormMessage state={state} />
      <MainButton
        type="submit"
        isLoading={isPending}
        loadingText="Зберігаємо…"
        disabled={withPicker && !placeComplete}
      >
        {submitLabel}
      </MainButton>
    </Form>
  );
}
