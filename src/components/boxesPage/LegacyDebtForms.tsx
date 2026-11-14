"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface AddLegacyDebtFormProps {
  action: FormAction;
  /** Клієнти для вибору; на картці клієнта він відомий (`fixedClientId`). */
  clients?: { id: string; name: string }[];
  fixedClientId?: string;
  types: { id: string; name: string }[];
}

/** «Додати борг за таблицею» (D114): клієнт, тип, кількість, з якого дня, примітка. */
export function AddLegacyDebtForm({
  action,
  clients,
  fixedClientId,
  types,
}: AddLegacyDebtFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = state.values ?? {};
  return (
    <Form action={formAction}>
      {fixedClientId ? <input type="hidden" name="clientId" value={fixedClientId} /> : null}
      {clients ? (
        <CustomizedSelect
          name="clientId"
          label="Клієнт"
          options={[
            { value: "", label: "Оберіть клієнта" },
            ...clients.map((c) => ({ value: c.id, label: c.name })),
          ]}
          defaultValue={values.clientId ?? ""}
          required
        />
      ) : null}
      <CustomizedSelect
        name="boxTypeId"
        label="Тип бокса"
        options={[
          { value: "", label: "Оберіть тип" },
          ...types.map((t) => ({ value: t.id, label: t.name })),
        ]}
        defaultValue={values.boxTypeId ?? ""}
        required
      />
      <CustomizedInput
        name="count"
        label="Скільки боксів"
        inputMode="numeric"
        autoComplete="off"
        defaultValue={values.count ?? ""}
        required
      />
      <CustomizedInput
        name="sinceDate"
        type="date"
        label="З якого дня"
        defaultValue={values.sinceDate ?? ""}
        hint="Можна лишити порожнім, якщо дата невідома."
      />
      <CustomizedInput
        name="note"
        label="Примітка"
        autoComplete="off"
        defaultValue={values.note ?? ""}
        hint="Наприклад, рядок у таблиці."
      />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        Додати борг
      </MainButton>
    </Form>
  );
}

interface ResolveLegacyFormProps {
  action: FormAction;
  id: string;
  openCount: number;
}

/** «Закрити N шт.»: клієнт повернув бокси без наклейки. */
export function ResolveLegacyForm({ action, id, openCount }: ResolveLegacyFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <CustomizedInput
        name="count"
        label="Скільки закрити"
        inputMode="numeric"
        autoComplete="off"
        defaultValue={state.status === "error" ? (state.values?.count ?? "") : String(openCount)}
        hint={`Не більше ${openCount}.`}
        required
      />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Закриваємо…">
        Закрити
      </MainButton>
    </Form>
  );
}
