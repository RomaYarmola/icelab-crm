"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import SectionTitle from "../shared/titles/SectionTitle";
import Text from "../shared/texts/Text";
import LabelsPdfForm from "./LabelsPdfForm";

interface GenerateBoxesFormProps {
  types: { id: string; name: string }[];
  /** Локації для вибору (власник). Старший локації створює лише у своїй, поле не показуємо. */
  locations: { id: string; name: string }[] | null;
  createAction: FormAction;
  markPrintedAction: FormAction;
}

/**
 * «Згенерувати бокси» (ТЗ 6.7): тип, кількість, локація. Після створення з'являються кнопка PDF з
 * наклейками й «Позначити надрукованими» (після друку).
 */
export default function GenerateBoxesForm({
  types,
  locations,
  createAction,
  markPrintedAction,
}: GenerateBoxesFormProps) {
  const [state, formAction, isPending] = useActionState(createAction, INITIAL_FORM_STATE);
  const [printed, printedAction, isMarking] = useActionState(markPrintedAction, INITIAL_FORM_STATE);
  const codes = state.status === "success" ? (state.values?.codes ?? "") : "";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Form action={formAction}>
        <CustomizedSelect
          name="boxTypeId"
          label="Тип бокса"
          options={[
            { value: "", label: "Оберіть тип" },
            ...types.map((t) => ({ value: t.id, label: t.name })),
          ]}
          defaultValue={state.values?.boxTypeId ?? ""}
          required
        />
        {locations ? (
          <CustomizedSelect
            name="locationId"
            label="Локація"
            options={[
              { value: "", label: "Оберіть локацію" },
              ...locations.map((l) => ({ value: l.id, label: l.name })),
            ]}
            defaultValue={state.values?.locationId ?? ""}
            required
          />
        ) : null}
        <CustomizedInput
          name="count"
          label="Скільки боксів"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={state.values?.count ?? ""}
          hint="Від 1 до 500. Коди видаються по порядку: K-0001, K-0002…"
          required
        />
        <FormMessage state={state} />
        <MainButton type="submit" isLoading={isPending} loadingText="Створюємо…">
          Створити бокси
        </MainButton>
      </Form>

      {codes ? (
        <section aria-labelledby="box-labels" className="flex flex-col gap-4">
          <SectionTitle id="box-labels">Наклейки</SectionTitle>
          <Text variant="muted">
            Відкрийте PDF, надрукуйте й наклейте на бокси. Після друку натисніть «Позначити
            надрукованими».
          </Text>
          <LabelsPdfForm codes={codes} label="Відкрити PDF з наклейками" />
          <Form action={printedAction}>
            <input type="hidden" name="codes" value={codes} />
            <FormMessage state={printed} />
            <MainButton type="submit" variant="outline" isLoading={isMarking}>
              Позначити надрукованими
            </MainButton>
          </Form>
        </section>
      ) : null}
    </div>
  );
}
