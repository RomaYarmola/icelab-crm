"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import type { FormAction } from "./clientActions";

/** Повертає видаленого клієнта до списку (лише власник). */
export default function RestoreClientForm({
  clientId,
  action,
}: {
  clientId: string;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="id" value={clientId} />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Повертаємо…">
        Повернути до списку
      </MainButton>
    </Form>
  );
}
