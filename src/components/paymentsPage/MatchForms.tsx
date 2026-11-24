"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

/** Кнопка підказки: один натиск зіставляє платіж із замовленням на вказану суму. */
export function SuggestionForm({
  paymentId,
  orderId,
  amount,
  label,
  action,
}: {
  paymentId: string;
  orderId: string;
  amount: string;
  label: string;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="amount" value={amount} />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зіставляємо…">
        {label}
      </MainButton>
    </Form>
  );
}

/** Зіставлення за номером замовлення й сумою: так платіж розкладають на кілька замовлень. */
export function ManualMatchForm({
  paymentId,
  unallocated,
  action,
}: {
  paymentId: string;
  unallocated: string;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Disclosure variant="plain" summary="Вказати замовлення вручну">
      <Form action={formAction}>
        <input type="hidden" name="paymentId" value={paymentId} />
        <CustomizedInput
          name="orderNumber"
          label="Номер замовлення"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={state.values?.orderNumber ?? ""}
          required
        />
        <CustomizedInput
          name="amount"
          label="Сума на це замовлення, ₴"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={state.values?.amount ?? unallocated.replace(/\.00$/, "")}
          hint="Платіж можна розкласти на кілька замовлень: вкажіть частину, решта лишиться в черзі."
          required
        />
        <FormMessage state={state} />
        <MainButton type="submit" isLoading={isPending} loadingText="Зіставляємо…">
          Зіставити
        </MainButton>
      </Form>
    </Disclosure>
  );
}

/** Одне поле причини й кнопка: «Ігнорувати» чи «Скасувати зіставлення». */
export function ReasonForm({
  paymentId,
  action,
  summary,
  button,
  loadingText,
  hint,
}: {
  paymentId: string;
  action: FormAction;
  summary: string;
  button: string;
  loadingText: string;
  hint?: string;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Disclosure variant="plain" summary={summary}>
      <Form action={formAction}>
        <input type="hidden" name="paymentId" value={paymentId} />
        <CustomizedInput
          name="reason"
          label="Причина"
          autoComplete="off"
          defaultValue={state.values?.reason ?? ""}
          hint={hint}
          required
        />
        <FormMessage state={state} />
        <MainButton type="submit" variant="outline" isLoading={isPending} loadingText={loadingText}>
          {button}
        </MainButton>
      </Form>
    </Disclosure>
  );
}

/** «Повернути в чергу» для ігнорованого платежу. */
export function RestoreForm({ paymentId, action }: { paymentId: string; action: FormAction }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <input type="hidden" name="paymentId" value={paymentId} />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Повертаємо…">
        Повернути в чергу
      </MainButton>
    </Form>
  );
}

/** Одна кнопка «Погасити за номерами з призначення» (D198). */
export function ByNumbersForm({
  paymentId,
  action,
  label,
}: {
  paymentId: string;
  action: FormAction;
  label: string;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Form action={formAction}>
      <input type="hidden" name="paymentId" value={paymentId} />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Гасимо…">
        {label}
      </MainButton>
    </Form>
  );
}

export type SelectableOrder = { orderId: string; label: string };

/** Список замовлень клієнта з прапорцями: платіж без номерів гасить вибрані (D198). */
export function SelectOrdersForm({
  paymentId,
  options,
  action,
}: {
  paymentId: string;
  options: SelectableOrder[];
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <Disclosure variant="plain" summary="Вибрати замовлення клієнта зі списку">
      <Form action={formAction}>
        <input type="hidden" name="paymentId" value={paymentId} />
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Замовлення клієнта</legend>
          {options.map((option) => (
            <label key={option.orderId} className="flex min-h-11 items-center gap-3 text-body">
              <input
                type="checkbox"
                name="orderId"
                value={option.orderId}
                className="size-5 shrink-0 accent-navy"
              />
              <span className="min-w-0 break-words">{option.label}</span>
            </label>
          ))}
        </fieldset>
        <FormMessage state={state} />
        <MainButton type="submit" isLoading={isPending} loadingText="Гасимо…">
          Погасити вибрані
        </MainButton>
      </Form>
    </Disclosure>
  );
}
