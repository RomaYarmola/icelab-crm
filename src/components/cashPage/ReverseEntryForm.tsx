"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface ReverseEntryFormProps {
  entryId: string;
  action: FormAction;
}

/**
 * Сторно помилкового запису (D69): лише власник і лише з причиною. Запис не видаляється: він
 * лишається в журналі, позначений скасованим, і в підсумках не рахується.
 */
export default function ReverseEntryForm({ entryId, action }: ReverseEntryFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Disclosure variant="plain" summary="Сторно (виправити помилку)">
      <Form action={formAction}>
        <input type="hidden" name="entryId" value={entryId} />
        <CustomizedInput
          name="reason"
          label="Причина сторно"
          as="textarea"
          defaultValue={state.values?.reason ?? ""}
          required
        />
        <FormMessage state={state} />
        <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
          Сторнувати запис
        </MainButton>
      </Form>
    </Disclosure>
  );
}
