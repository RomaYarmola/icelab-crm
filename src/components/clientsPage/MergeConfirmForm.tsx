"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import type { FormAction } from "./clientActions";

/** Підтвердження об'єднання: відкоту немає, тому дія лише після підсумку «що перейде». */
export default function MergeConfirmForm({
  mainId,
  duplicateId,
  action,
}: {
  mainId: string;
  duplicateId: string;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="mainId" value={mainId} />
      <input type="hidden" name="duplicateId" value={duplicateId} />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Об'єднуємо…">
        Об’єднати клієнтів
      </MainButton>
    </Form>
  );
}
