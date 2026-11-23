"use client";

import { useActionState, useState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import type { FormAction } from "./clientActions";

export interface OwnBoxFormDefaults {
  name: string;
  /** `ice` бокс для льоду, `dewar` сосуд Дюара для азоту. */
  kind: string;
  volumeL: string;
  capacityKg: string;
  emptyWeightKg: string;
  heightMm: string;
  widthMm: string;
  lengthMm: string;
  note: string;
}

export const EMPTY_OWN_BOX: OwnBoxFormDefaults = {
  name: "",
  kind: "ice",
  volumeL: "",
  capacityKg: "",
  emptyWeightKg: "",
  heightMm: "",
  widthMm: "",
  lengthMm: "",
  note: "",
};

interface OwnBoxFormProps {
  mode: "add" | "edit";
  clientId?: string;
  boxId?: string;
  defaults: OwnBoxFormDefaults;
  action: FormAction;
  submitLabel: string;
}

/**
 * Форма бокса клієнта (D164): назва обов'язкова, решта необов'язкова й орієнтовна. Дані йдуть
 * у накладну Нової Пошти (вага, розміри) і в підказку «виготовити» (скільки кг вміщає).
 */
export default function OwnBoxForm({
  mode,
  clientId,
  boxId,
  defaults,
  action,
  submitLabel,
}: OwnBoxFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { ...defaults, ...state.values };
  const [kind, setKind] = useState(values.kind);
  const isDewar = kind === "dewar";

  return (
    <Form action={formAction}>
      {mode === "add" ? <input type="hidden" name="clientId" value={clientId} /> : null}
      {mode === "edit" ? <input type="hidden" name="id" value={boxId} /> : null}
      <CustomizedInput
        name="name"
        label="Назва бокса"
        autoComplete="off"
        defaultValue={values.name}
        hint="Наприклад, «Сірий великий»."
      />
      <CustomizedSelect
        name="kind"
        label="Що це"
        options={[
          { value: "ice", label: "Бокс для льоду" },
          { value: "dewar", label: "Сосуд Дюара (для рідкого азоту)" },
        ]}
        value={kind}
        onChange={(event) => setKind(event.target.value)}
      />
      {isDewar ? null : (
        <>
          <CustomizedInput
            name="capacityKg"
            label="Скільки кг льоду вміщає"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={values.capacityKg}
            hint="Необов'язково. Більше цього числа система не запропонує класти."
          />
          <CustomizedInput
            name="emptyWeightKg"
            label="Вага порожнього, кг"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={values.emptyWeightKg}
            hint="Необов'язково. Якщо порожньо, в накладну додається 1 кг на бокс."
          />
          <CustomizedInput
            name="volumeL"
            label="Об'єм, л"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.volumeL}
            hint="Необов'язково."
          />
          <CustomizedInput
            name="heightMm"
            label="Висота зовні, мм"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.heightMm}
            hint="Розміри необов'язкові й можуть бути орієнтовними."
          />
          <CustomizedInput
            name="widthMm"
            label="Ширина зовні, мм"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.widthMm}
          />
          <CustomizedInput
            name="lengthMm"
            label="Довжина зовні, мм"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.lengthMm}
          />
        </>
      )}
      <CustomizedInput
        name="note"
        label="Примітка"
        as="textarea"
        defaultValue={values.note}
        hint="Необов'язково: наприклад, товщина стінки."
      />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        {submitLabel}
      </MainButton>
    </Form>
  );
}
