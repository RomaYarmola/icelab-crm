"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import type { NpActions } from "./npTypes";

/** «Зіставити автоматично»: однозначні адреси клієнтів зіставляються з довідником Нової Пошти. */
export default function AutoResolve({ action }: { action: NpActions["autoResolve"] }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зіставляємо…">
        Зіставити автоматично
      </MainButton>
    </Form>
  );
}
