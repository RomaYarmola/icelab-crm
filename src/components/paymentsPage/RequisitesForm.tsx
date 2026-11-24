"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

/** Реквізити для оплати: додаються до повідомлення клієнтові (вкладка «Борги»). Зберігаються в базі. */
export default function RequisitesForm({
  requisites,
  action,
}: {
  requisites: string | null;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <CustomizedInput
        name="requisites"
        as="textarea"
        label="Реквізити для оплати"
        defaultValue={state.values?.requisites ?? requisites ?? ""}
        hint="Отримувач, код, рахунок. Додаються до повідомлення клієнтові; призначення платежу з номерами CRM складе сама."
      />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
        Зберегти реквізити
      </MainButton>
    </Form>
  );
}
