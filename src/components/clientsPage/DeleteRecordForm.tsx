"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";
import type { FormAction } from "./clientActions";

interface DeleteRecordFormProps {
  action: FormAction;
  /** Ідентифікатор запису, що видаляється (контакт, адреса). */
  id: string;
  /** Підпис кнопки, що розкриває підтвердження: «Видалити контакт». */
  summary: string;
  /** Що станеться: показуємо перед остаточною кнопкою. */
  warning: string;
}

/** Видалення запису у два кроки: розкрити підтвердження, потім натиснути «Видалити». */
export default function DeleteRecordForm({ action, id, summary, warning }: DeleteRecordFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Disclosure variant="plain" summary={summary}>
      <Form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <Text variant="muted">{warning}</Text>
        <FormMessage state={state} />
        <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Видаляємо…">
          Так, видалити
        </MainButton>
      </Form>
    </Disclosure>
  );
}
