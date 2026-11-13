"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

interface OrderTransitionFormProps {
  orderId: string;
  /** Статус, у який переводимо. */
  to: string;
  action: FormAction;
  /** Напис на кнопці. */
  label: string;
  /** Потрібна примітка (причина): тоді кнопка ховається в розкривний блок із полем. */
  needsNote: boolean;
  /** Підпис поля примітки. */
  noteLabel?: string;
  /** Основна (темна) кнопка чи контурна. */
  variant?: "fill" | "outline";
  /** Розмір кнопки: на екрані виробництва `lg` (від 56 px). */
  size?: "lg" | "md" | "sm";
}

/**
 * Одна кнопка переходу статусу. Без примітки це звичайна кнопка в один дотик; з приміткою
 * (скасування, крок назад, ручне «Оплачено») кнопка лежить у розкривному блоці під полем причини.
 */
export default function OrderTransitionForm({
  orderId,
  to,
  action,
  label,
  needsNote,
  noteLabel = "Причина",
  variant = "outline",
  size = "md",
}: OrderTransitionFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  const form = (
    <Form action={formAction}>
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="to" value={to} />
      {needsNote ? (
        <CustomizedInput
          name="note"
          label={noteLabel}
          as="textarea"
          defaultValue={state.values?.note ?? ""}
          required
        />
      ) : null}
      <FormMessage state={state} />
      <MainButton
        type="submit"
        variant={variant}
        size={size}
        isLoading={isPending}
        loadingText="Зберігаємо…"
      >
        {label}
      </MainButton>
    </Form>
  );

  return needsNote ? <Disclosure summary={label}>{form}</Disclosure> : form;
}
