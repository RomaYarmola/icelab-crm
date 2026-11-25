"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

/** «Відкласти»: прибирає нагадування зі свого списку; про того самого знову не раніше ніж за 7 днів. */
export default function DismissForm({
  reminderId,
  action,
}: {
  reminderId: string;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <input type="hidden" name="reminderId" value={reminderId} />
      <FormMessage state={state} />
      <MainButton
        type="submit"
        variant="outline"
        size="sm"
        isLoading={isPending}
        loadingText="Прибираємо…"
      >
        Відкласти
      </MainButton>
    </Form>
  );
}
