"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface OrderPriceFormProps {
  orderId: string;
  action: FormAction;
}

/** Зміна ціни підтвердженого замовлення (лише власник, D52): нова ціна за кг і причина обов'язкова. */
export default function OrderPriceForm({ orderId, action }: OrderPriceFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { pricePerKg: "", note: "", ...state.values };

  return (
    <Disclosure summary="Змінити ціну">
      <Form action={formAction}>
        <input type="hidden" name="id" value={orderId} />
        <CustomizedInput
          name="pricePerKg"
          label="Нова ціна, ₴/кг"
          inputMode="decimal"
          autoComplete="off"
          placeholder="70"
          defaultValue={values.pricePerKg}
          required
        />
        <CustomizedInput
          name="note"
          label="Причина зміни"
          as="textarea"
          defaultValue={values.note}
          hint="Обов'язково: зміна й причина лишаються в історії."
          required
        />
        <FormMessage state={state} />
        <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
          Зберегти нову ціну
        </MainButton>
      </Form>
    </Disclosure>
  );
}
