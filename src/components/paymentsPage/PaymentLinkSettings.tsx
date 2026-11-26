"use client";

import { useActionState } from "react";
import type { PaymentLinkStatus } from "@/server/payment-links";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";

interface PaymentLinkSettingsProps {
  status: PaymentLinkStatus;
  canWrite: boolean;
  action: FormAction;
}

/** Підключення IBAN oplata на вкладці «Банк»: чи є ключ і на який рахунок створювати посилання. */
export default function PaymentLinkSettings({
  status,
  canWrite,
  action,
}: PaymentLinkSettingsProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <section aria-labelledby="payments-links" className="flex flex-col gap-3">
      <SectionTitle id="payments-links">Посилання на оплату (IBAN oplata)</SectionTitle>
      {!status.hasKey ? (
        <Notification variant="warning" title="Ключ не налаштований">
          Додайте у змінні середовища сервера ключ IBANOPLATA_API_KEY і перезапустіть застосунок.
          Доти посилання створюють вручну в кабінеті сервісу.
        </Notification>
      ) : status.error ? (
        <Notification variant="error">{status.error}</Notification>
      ) : status.accounts.length === 0 ? (
        <Notification variant="warning">
          У кабінеті сервісу немає чинних реквізитів: додайте їх там.
        </Notification>
      ) : (
        <>
          <Notification variant={status.selectedUid ? "success" : "warning"}>
            {status.selectedUid
              ? "Посилання створюються автоматично."
              : "Оберіть, на який рахунок створювати посилання."}
          </Notification>
          {canWrite ? (
            <Form action={formAction}>
              <CustomizedSelect
                key={status.selectedUid ?? "none"}
                name="accountUid"
                label="Рахунок для посилань"
                options={status.accounts.map((a) => ({ value: a.uid, label: a.label }))}
                defaultValue={status.selectedUid ?? status.accounts[0]!.uid}
              />
              <FormMessage state={state} />
              <MainButton
                type="submit"
                variant="outline"
                isLoading={isPending}
                loadingText="Зберігаємо…"
              >
                Зберегти рахунок
              </MainButton>
            </Form>
          ) : (
            <Text variant="muted">Рахунок обирає власник або бухгалтер.</Text>
          )}
        </>
      )}
    </section>
  );
}
