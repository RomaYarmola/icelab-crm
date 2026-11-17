"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface ShipmentRefreshFormProps {
  orderId: string;
  action: FormAction;
}

/** «Оновити статус»: питає Нову Пошту про накладну зараз, не чекаючи розкладу (кожні 15 хвилин). */
export default function ShipmentRefreshForm({ orderId, action }: ShipmentRefreshFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Оновлюємо…">
        Оновити статус
      </MainButton>
    </Form>
  );
}
