"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

export interface Co2Field {
  name: string;
  label: string;
  type?: "date";
  /** Число з комою чи крапкою: клавіатура з цифрами. */
  decimal?: boolean;
  /** Початкове значення (наприклад, сьогоднішня дата). */
  initial?: string;
  hint?: string;
  optional?: boolean;
}

interface Co2FormProps {
  action: FormAction;
  locationId: string;
  fields: Co2Field[];
  submitLabel: string;
}

/** Форма запису по сировині (прихід, списаний лід, залишок, норма): поля задає сторінка. */
export default function Co2Form({ action, locationId, fields, submitLabel }: Co2FormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="locationId" value={locationId} />
      {fields.map((field) => (
        <CustomizedInput
          key={field.name}
          name={field.name}
          label={field.label}
          type={field.type}
          inputMode={field.decimal ? "decimal" : undefined}
          autoComplete="off"
          // Після помилки лишаємо введене, після успіху повертаємось до початкових значень.
          defaultValue={state.values?.[field.name] ?? field.initial ?? ""}
          hint={field.hint}
          required={!field.optional}
        />
      ))}
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        {submitLabel}
      </MainButton>
    </Form>
  );
}
