"use client";

import { useActionState, useState, useTransition } from "react";
import type { NpOption } from "@/server/np/settings";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Notification from "../shared/notification/Notification";
import type { NpActions } from "./npTypes";

interface SenderFormProps {
  locationId: string;
  currentPhone: string | null;
  actions: Pick<NpActions, "loadSenders" | "loadSenderDetails" | "saveSender">;
}

const pick = (options: NpOption[]) => [
  { value: "", label: "Оберіть" },
  ...options.map((option) => ({ value: option.ref, label: option.name })),
];
const nameOf = (options: NpOption[], ref: string) =>
  options.find((option) => option.ref === ref)?.name ?? "";

/**
 * Вибір відправника локації з того, що віддає Нова Пошта: спершу відправник (контрагент), потім його
 * контактна особа й адреса відправлення, потім телефон. Дані підтягуються за натисканням, тож без
 * ключа форма просто покаже помилку.
 */
export default function SenderForm({ locationId, currentPhone, actions }: SenderFormProps) {
  const [state, formAction, isSaving] = useActionState(actions.saveSender, INITIAL_FORM_STATE);
  const [isLoading, startLoading] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [senders, setSenders] = useState<NpOption[] | null>(null);
  const [details, setDetails] = useState<{ contacts: NpOption[]; addresses: NpOption[] } | null>(
    null,
  );
  const [senderRef, setSenderRef] = useState("");
  const [contactRef, setContactRef] = useState("");
  const [addressRef, setAddressRef] = useState("");

  function loadSenders() {
    setError(null);
    startLoading(async () => {
      const result = await actions.loadSenders();
      if (result.ok) setSenders(result.data);
      else setError(result.message);
    });
  }

  function chooseSender(ref: string) {
    setSenderRef(ref);
    setContactRef("");
    setAddressRef("");
    setDetails(null);
    setError(null);
    if (!ref) return;
    startLoading(async () => {
      const result = await actions.loadSenderDetails(ref);
      if (result.ok) setDetails(result.data);
      else setError(result.message);
    });
  }

  if (senders === null) {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Notification variant="error">{error}</Notification> : null}
        <MainButton
          variant="outline"
          onClick={loadSenders}
          isLoading={isLoading}
          loadingText="Завантажуємо…"
        >
          Завантажити відправників з Нової Пошти
        </MainButton>
      </div>
    );
  }

  return (
    <Form action={formAction}>
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="senderName" value={nameOf(senders, senderRef)} />
      <input type="hidden" name="contactName" value={nameOf(details?.contacts ?? [], contactRef)} />
      <input
        type="hidden"
        name="addressName"
        value={nameOf(details?.addresses ?? [], addressRef)}
      />
      {error ? <Notification variant="error">{error}</Notification> : null}
      <CustomizedSelect
        name="senderRef"
        label="Відправник"
        options={pick(senders)}
        value={senderRef}
        onChange={(event) => chooseSender(event.target.value)}
        required
      />
      <CustomizedSelect
        name="contactRef"
        label="Контактна особа"
        options={pick(details?.contacts ?? [])}
        value={contactRef}
        onChange={(event) => setContactRef(event.target.value)}
        disabled={!details}
        required
      />
      <CustomizedSelect
        name="addressRef"
        label="Адреса відправлення"
        options={pick(details?.addresses ?? [])}
        value={addressRef}
        onChange={(event) => setAddressRef(event.target.value)}
        disabled={!details}
        required
      />
      <CustomizedInput
        name="phone"
        type="tel"
        label="Телефон відправника"
        inputMode="tel"
        autoComplete="off"
        placeholder="+380501234567"
        defaultValue={state.values?.phone ?? currentPhone ?? ""}
        hint="Формат +380501234567."
        required
      />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isSaving || isLoading} loadingText="Зберігаємо…">
        Зберегти відправника
      </MainButton>
    </Form>
  );
}
