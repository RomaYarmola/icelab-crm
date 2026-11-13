"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface ProductionEditFormProps {
  orderId: string;
  /** Поточне «виготовити», кг без зайвих нулів. */
  kgToProduce: string;
  comment: string | null;
  action: FormAction;
}

/**
 * Старший локації міняє «виготовити» (кг) і коментар для виробництва прямо з картки (D58): без
 * переходу на сторінку замовлення. Ховається в розкривний блок, щоб не заважати основній кнопці.
 */
export default function ProductionEditForm({
  orderId,
  kgToProduce,
  comment,
  action,
}: ProductionEditFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Disclosure summary="Змінити кг чи коментар" variant="plain">
      <Form action={formAction}>
        <input type="hidden" name="id" value={orderId} />
        <CustomizedInput
          name="kgToProduce"
          label="Виготовити, кг"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={state.values?.kgToProduce ?? kgToProduce}
          required
        />
        <CustomizedInput
          name="comment"
          label="Коментар для виробництва"
          as="textarea"
          defaultValue={state.values?.comment ?? comment ?? ""}
        />
        <FormMessage state={state} />
        <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
          Зберегти
        </MainButton>
      </Form>
    </Disclosure>
  );
}
