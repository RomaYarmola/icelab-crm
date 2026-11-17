"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface EmptyWeightFormProps {
  action: FormAction;
  boxTypeId: string;
  name: string;
  /** Поточна вага, кг, або `null`. */
  weightKg: string | null;
}

/** Вага порожнього бокса одного типу: додається до ваги посилки в накладній (D127). */
export default function EmptyWeightForm({
  action,
  boxTypeId,
  name,
  weightKg,
}: EmptyWeightFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const current = weightKg === null ? "" : String(Number(weightKg));
  return (
    <Form action={formAction}>
      <input type="hidden" name="boxTypeId" value={boxTypeId} />
      <CustomizedInput
        name="weightKg"
        label={name}
        inputMode="decimal"
        autoComplete="off"
        placeholder="Наприклад, 1,5"
        defaultValue={state.status === "error" ? (state.values?.weightKg ?? current) : current}
        hint="Вага порожнього бокса, кг. Порожнє поле: вага невідома."
      />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
        Зберегти
      </MainButton>
    </Form>
  );
}
