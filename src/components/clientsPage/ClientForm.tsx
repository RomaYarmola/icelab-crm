"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LEGAL_TYPE_LABELS, NO_REGION_LABEL } from "@/constants/clients";
import type { ClientFormOptions } from "@/server/client-options";
import type { SimilarClient } from "@/server/clients";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import PhoneField from "../shared/customizedInput/PhoneField";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";
import type { FormAction, NewClientActions } from "./clientActions";
import SimilarClientsNotice from "./SimilarClientsNotice";
import { toSelectOptions } from "./selectOptions";

export interface ClientFormDefaults {
  name: string;
  regionPrefix: string;
  phone: string;
  contactName: string;
  legalType: string;
  edrpou: string;
  iceTypeId: string;
  applicationId: string;
  statusId: string;
  managerId: string;
  sourceId: string;
  defaultBoxTypeId: string;
  markupPercentOverride: string;
  inactiveDaysThreshold: string;
  notes: string;
}

export const EMPTY_CLIENT_DEFAULTS: ClientFormDefaults = {
  name: "",
  regionPrefix: "",
  phone: "",
  contactName: "",
  legalType: "",
  edrpou: "",
  iceTypeId: "",
  applicationId: "",
  statusId: "",
  managerId: "",
  sourceId: "",
  defaultBoxTypeId: "",
  markupPercentOverride: "",
  inactiveDaysThreshold: "",
  notes: "",
};

interface ClientFormProps {
  /** `create`: новий клієнт (область, телефон, підказки), `edit`: зміна полів картки. */
  mode: "create" | "edit";
  /** Для `edit`: чий це клієнт (приховане поле `id`) і його код (показуємо, не міняємо). */
  clientId?: string;
  code?: string;
  options: ClientFormOptions;
  defaults: ClientFormDefaults;
  action: FormAction;
  submitLabel: string;
  /** Лише для `create`: підказка «буде АА16» за областю. */
  previewCode?: NewClientActions["previewCode"];
  /** Лише для `create`: підказка «Схожі клієнти» (D48). */
  findSimilar?: NewClientActions["findSimilar"];
}

const LEGAL_TYPE_OPTIONS = [
  { value: "", label: "Не вказано" },
  ...Object.entries(LEGAL_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];

/**
 * Форма клієнта: створення і зміна. Поля зведено до потрібних щодня, рідкісні (тип льоду, тара,
 * реквізити, надбавка) лежать у блоці «Додатково». Код видає сервер: менеджер вибирає лише область
 * (D42). Після помилки сервер повертає введене, і поля показують його.
 */
export default function ClientForm({
  mode,
  clientId,
  code,
  options,
  defaults,
  action,
  submitLabel,
  previewCode,
  findSimilar,
}: ClientFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { ...defaults, ...state.values };
  const isCreate = mode === "create";

  const [region, setRegion] = useState(values.regionPrefix);
  const [codeHint, setCodeHint] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarClient[]>([]);
  const similarRequest = useRef(0);

  useEffect(() => {
    if (!isCreate || !previewCode) return;
    let isCurrent = true;
    previewCode(region).then((hint) => {
      if (isCurrent) setCodeHint(hint);
    });
    return () => {
      isCurrent = false;
    };
  }, [isCreate, previewCode, region]);

  function checkSimilar(form: HTMLFormElement) {
    if (!findSimilar) return;
    const data = new FormData(form);
    const request = ++similarRequest.current;
    findSimilar({
      name: String(data.get("name") ?? ""),
      phone: String(data.get("phone") ?? ""),
    }).then((found) => {
      // Відповідь на застарілий запит (поле змінили ще раз) відкидаємо.
      if (request === similarRequest.current) setSimilar(found);
    });
  }

  return (
    <Form
      action={formAction}
      onBlur={(event) => {
        const target = event.target;
        if (isCreate && target instanceof HTMLInputElement) {
          if (target.name === "name" || target.name === "phone") checkSimilar(event.currentTarget);
        }
      }}
    >
      {clientId ? <input type="hidden" name="id" value={clientId} /> : null}

      {code ? (
        <div className="flex flex-col gap-1.5">
          <Text variant="label">Код клієнта</Text>
          <Text variant="muted">{code}</Text>
        </div>
      ) : null}

      <CustomizedInput
        name="name"
        label="Назва"
        autoComplete="off"
        defaultValue={values.name}
        required
      />

      {isCreate ? (
        <>
          <CustomizedSelect
            name="regionPrefix"
            label="Область"
            options={[
              { value: "", label: NO_REGION_LABEL },
              ...options.regions.map((item) => ({
                value: item.prefix,
                label: `${item.prefix} · ${item.name}`,
              })),
            ]}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            hint={
              codeHint
                ? `Код клієнта буде ${codeHint}. Остаточний номер видається при збереженні.`
                : undefined
            }
          />
          <PhoneField
            name="phone"
            label="Телефон"
            defaultValue={values.phone}
            hint="Необов'язково. Стане основним контактом."
          />
          <CustomizedInput
            name="contactName"
            label="Ім'я контакту"
            autoComplete="off"
            defaultValue={values.contactName}
            hint="Необов'язково: хто на зв'язку."
          />
          <SimilarClientsNotice clients={similar} />
        </>
      ) : null}

      <CustomizedSelect
        name="legalType"
        label="Тип клієнта"
        options={LEGAL_TYPE_OPTIONS}
        defaultValue={values.legalType}
      />
      <CustomizedSelect
        name="applicationId"
        label="Застосування"
        options={toSelectOptions(options.applications, "Не вказано")}
        defaultValue={values.applicationId}
      />
      <CustomizedSelect
        name="sourceId"
        label="Джерело"
        options={toSelectOptions(options.sources, "Не вказано")}
        defaultValue={values.sourceId}
      />
      <CustomizedSelect
        name="statusId"
        label="Статус"
        options={toSelectOptions(options.statuses, isCreate ? undefined : "Не вказано")}
        defaultValue={values.statusId}
      />
      <CustomizedSelect
        name="managerId"
        label="Менеджер"
        options={toSelectOptions(options.managers, isCreate ? undefined : "Не призначено")}
        defaultValue={values.managerId}
      />
      <CustomizedInput
        name="notes"
        label="Примітка"
        as="textarea"
        defaultValue={values.notes}
        hint="Необов'язково."
      />

      <Disclosure summary="Додатково">
        <div className="flex flex-col gap-4">
          <CustomizedSelect
            name="iceTypeId"
            label="Основний тип льоду"
            options={toSelectOptions(options.iceTypes, "Не вказано")}
            defaultValue={values.iceTypeId}
          />
          <CustomizedSelect
            name="defaultBoxTypeId"
            label="Основна тара"
            options={toSelectOptions(options.boxTypes, "Не вказано")}
            defaultValue={values.defaultBoxTypeId}
          />
          <CustomizedInput
            name="edrpou"
            label="ЄДРПОУ або ІПН"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.edrpou}
            hint="8 цифр (ЄДРПОУ) або 10 (ІПН). Необов'язково."
          />
          <CustomizedInput
            name="markupPercentOverride"
            label="Окрема надбавка, %"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={values.markupPercentOverride}
            hint="Від 0 до 100. Порожнє поле: діє загальна надбавка."
          />
          <CustomizedInput
            name="inactiveDaysThreshold"
            label="Нагадати, якщо не замовляє, днів"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.inactiveDaysThreshold}
            hint="Необов'язково."
          />
        </div>
      </Disclosure>

      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        {submitLabel}
      </MainButton>
    </Form>
  );
}
