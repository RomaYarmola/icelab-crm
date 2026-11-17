"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface ActionFormProps {
  action: FormAction;
  label: string;
  loadingText: string;
  /** Приховані поля форми (ідентифікатор користувача, топік). */
  fields?: Record<string, string>;
  variant?: "fill" | "outline";
  disabled?: boolean;
}

/** Кнопка-дія з повідомленням про результат під нею: усі дії екрана «Прийом заявок» простими формами. */
export default function ActionForm({
  action,
  label,
  loadingText,
  fields = {},
  variant = "outline",
  disabled = false,
}: ActionFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormMessage state={state} />
      <MainButton
        type="submit"
        variant={variant}
        disabled={disabled}
        isLoading={isPending}
        loadingText={loadingText}
      >
        {label}
      </MainButton>
    </Form>
  );
}
