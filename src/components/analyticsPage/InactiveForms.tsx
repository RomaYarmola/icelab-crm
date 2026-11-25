"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

/** «Позначити разовим»: клієнт зникає зі списку й нагадувань. Позначку можна зняти в картці. */
export function OneTimeForm({ clientId, action }: { clientId: string; action: FormAction }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <FormMessage state={state} />
      <MainButton
        type="submit"
        variant="outline"
        size="sm"
        isLoading={isPending}
        loadingText="Зберігаємо…"
      >
        Позначити разовим
      </MainButton>
    </Form>
  );
}

/** Загальний поріг «давно не замовляв» (лише власник). */
export function ThresholdForm({ days, action }: { days: number; action: FormAction }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Disclosure variant="plain" summary="Загальний поріг">
      <Form action={formAction}>
        <CustomizedInput
          name="days"
          label="Давно не замовляє через, днів"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={state.values?.days ?? String(days)}
          hint="Для окремого клієнта поріг можна задати в його картці."
          required
        />
        <FormMessage state={state} />
        <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
          Зберегти поріг
        </MainButton>
      </Form>
    </Disclosure>
  );
}
