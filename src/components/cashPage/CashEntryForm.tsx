"use client";

import { useActionState } from "react";
import { formatMoney } from "@/utils/formatNumber";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import { parseDecimal } from "@/utils/orderMath";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface CashEntryFormProps {
  orderId: string;
  /** Скільки ще не прийнято, гривні рядком («1250.00»). Це сума за замовчуванням. */
  remainingSum: string;
  action: FormAction;
}

/** «1250.00» для поля: ціле без копійок, інакше з комою («450,5»). */
function toField(value: string): string {
  const number = parseDecimal(value);
  return Number.isInteger(number) ? String(number) : String(number).replace(".", ",");
}

/**
 * «Прийнято готівку»: сума (за замовчуванням увесь залишок), хто прийняв, примітка. Більше залишку
 * система не прийме, підказка показує, скільки лишилось. Коли прийнято всю суму, замовлення саме
 * стає «Оплачено» (D67).
 */
export default function CashEntryForm({ orderId, remainingSum, action }: CashEntryFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <CustomizedInput
        name="amount"
        label="Прийнято, ₴"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={state.values?.amount ?? toField(remainingSum)}
        hint={`Лишилось ${formatMoney(parseDecimal(remainingSum))}`}
        required
      />
      <Disclosure variant="plain" summary="Хто прийняв і примітка">
        <div className="flex flex-col gap-4">
          <CustomizedInput
            name="receivedBy"
            label="Хто прийняв, якщо не ви"
            autoComplete="off"
            defaultValue={state.values?.receivedBy ?? ""}
            hint="Наприклад, ім'я водія."
          />
          <CustomizedInput
            name="note"
            label="Примітка"
            as="textarea"
            defaultValue={state.values?.note ?? ""}
          />
        </div>
      </Disclosure>
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        Прийнято готівку
      </MainButton>
    </Form>
  );
}
