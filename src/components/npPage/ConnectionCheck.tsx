"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface ConnectionCheckProps {
  action: FormAction;
  /** Без ключа перевіряти нічого: кнопка вимкнена. */
  disabled: boolean;
}

/** «Перевірити з’єднання»: робить один дешевий запит до Нової Пошти й показує результат. */
export default function ConnectionCheck({ action, disabled }: ConnectionCheckProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <FormMessage state={state} />
      <MainButton
        type="submit"
        variant="outline"
        disabled={disabled}
        isLoading={isPending}
        loadingText="Перевіряємо…"
      >
        Перевірити з’єднання
      </MainButton>
    </Form>
  );
}
