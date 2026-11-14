"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface TransferBoxFormProps {
  action: FormAction;
  code: string;
  locations: { id: string; name: string }[];
}

/** «Перемістити в іншу локацію» (лише власник, бокс «На складі»): змінює домашню локацію. */
export default function TransferBoxForm({ action, code, locations }: TransferBoxFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <input type="hidden" name="code" value={code} />
      <CustomizedSelect
        name="toLocationId"
        label="Нова локація"
        options={[
          { value: "", label: "Оберіть локацію" },
          ...locations.map((l) => ({ value: l.id, label: l.name })),
        ]}
        defaultValue={state.values?.toLocationId ?? ""}
        required
      />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Переміщуємо…">
        Перемістити
      </MainButton>
    </Form>
  );
}
