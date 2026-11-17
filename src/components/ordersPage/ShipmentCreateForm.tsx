"use client";

import { useActionState, useState } from "react";
import { NP_PAYER_LABELS } from "@/constants/np";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface ShipmentCreateFormProps {
  orderId: string;
  createAction: FormAction;
  /** «Порахувати вартість»: лише ролям, що бачать гроші замовлення. */
  priceAction: FormAction | null;
  /** Підпис кнопки: «Створити ТТН» чи «Спробувати ще раз». */
  submitLabel: string;
}

const PAYER_OPTIONS = Object.entries(NP_PAYER_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Створення ТТН: платник (одержувач типово), «Порахувати вартість» до створення (ТЗ 8.4) і
 * «Створити ТТН». Дві окремі форми з одним вибраним платником.
 */
export default function ShipmentCreateForm({
  orderId,
  createAction,
  priceAction,
  submitLabel,
}: ShipmentCreateFormProps) {
  const [payer, setPayer] = useState("Recipient");
  const [created, createFormAction, isCreating] = useActionState(createAction, INITIAL_FORM_STATE);
  const [priced, priceFormAction, isPricing] = useActionState(
    priceAction ?? createAction,
    INITIAL_FORM_STATE,
  );

  return (
    <div className="flex flex-col gap-3">
      <CustomizedSelect
        name="payerChoice"
        label="Хто платить за доставку"
        options={PAYER_OPTIONS}
        value={payer}
        onChange={(event) => setPayer(event.target.value)}
      />
      {priceAction ? (
        <Form action={priceFormAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="payer" value={payer} />
          <FormMessage state={priced} />
          <MainButton type="submit" variant="outline" isLoading={isPricing} loadingText="Рахуємо…">
            Порахувати вартість
          </MainButton>
        </Form>
      ) : null}
      <Form action={createFormAction}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="payer" value={payer} />
        <FormMessage state={created} />
        <MainButton type="submit" isLoading={isCreating} loadingText="Створюємо ТТН…">
          {submitLabel}
        </MainButton>
      </Form>
    </div>
  );
}
