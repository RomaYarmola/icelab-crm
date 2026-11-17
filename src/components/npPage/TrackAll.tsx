"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import type { NpActions } from "./npTypes";

/** «Оновити статуси зараз»: трекінг усіх незавершених накладних без очікування розкладу. */
export default function TrackAll({
  action,
  disabled,
}: {
  action: NpActions["trackAll"];
  disabled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <FormMessage state={state} />
      <MainButton
        type="submit"
        variant="outline"
        disabled={disabled}
        isLoading={isPending}
        loadingText="Оновлюємо…"
      >
        Оновити статуси зараз
      </MainButton>
    </Form>
  );
}
