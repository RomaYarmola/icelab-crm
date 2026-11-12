"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import Checkbox from "../shared/customizedInput/Checkbox";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import PhoneField from "../shared/customizedInput/PhoneField";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import type { FormAction } from "./clientActions";

export interface ContactFormDefaults {
  name: string;
  phone: string;
  role: string;
  isPrimary: boolean;
}

interface ContactFormProps {
  /** `add`: новий контакт клієнта (`clientId`), `edit`: зміна наявного (`contactId`). */
  mode: "add" | "edit";
  clientId?: string;
  contactId?: string;
  defaults: ContactFormDefaults;
  action: FormAction;
  submitLabel: string;
}

/** Форма контакту: ім'я, телефон, посада і прапорець «основний» (основний контакт один). */
export default function ContactForm({
  mode,
  clientId,
  contactId,
  defaults,
  action,
  submitLabel,
}: ContactFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { ...defaults, ...state.values };

  return (
    <Form action={formAction}>
      {mode === "add" ? <input type="hidden" name="clientId" value={clientId} /> : null}
      {mode === "edit" ? <input type="hidden" name="id" value={contactId} /> : null}
      <CustomizedInput
        name="name"
        label="Ім'я"
        autoComplete="off"
        defaultValue={values.name}
        hint="Хто на зв'язку."
      />
      <PhoneField name="phone" label="Телефон" defaultValue={values.phone} />
      <CustomizedInput
        name="role"
        label="Посада"
        autoComplete="off"
        defaultValue={values.role}
        hint="Необов'язково: наприклад, закупівлі."
      />
      <Checkbox
        name="isPrimary"
        label="Основний контакт"
        defaultChecked={defaults.isPrimary}
        hint="Основний телефон видно в списку клієнтів."
      />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        {submitLabel}
      </MainButton>
    </Form>
  );
}
