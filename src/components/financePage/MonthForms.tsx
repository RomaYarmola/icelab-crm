"use client";

import { useActionState } from "react";
import type { EntryScope, MonthPageData } from "@/server/finance/month";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import { parseDecimal } from "@/utils/orderMath";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import Checkbox from "../shared/customizedInput/Checkbox";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

/** «1500.00» з бази показуємо в полі як «1500». */
const shown = (value: string | null) => (value === null ? "" : String(parseDecimal(value)));

interface ScopedProps {
  action: FormAction;
  month: string;
}

/** Суми всіх статей одного міста (чи спільні) за місяць однією формою. */
export function EntriesForm({ action, month, scope }: ScopedProps & { scope: EntryScope }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="locationId" value={scope.locationId ?? ""} />
      {scope.fields.map((field) => {
        const name = `amount:${field.categoryId}`;
        return (
          <CustomizedInput
            key={`${field.categoryId}:${field.amount}`}
            name={name}
            label={`${field.name}${field.kind === "income" ? " (дохід)" : ""}, ₴`}
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values?.[name] ?? shown(field.amount ?? field.suggestion)}
            hint={
              field.suggestion !== null
                ? "Підставлено з минулого місяця, ще не збережено."
                : undefined
            }
          />
        );
      })}
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        Зберегти суми
      </MainButton>
    </Form>
  );
}

export function UsdRateForm({ action, month, rate }: ScopedProps & { rate: number | null }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="month" value={month} />
      <CustomizedInput
        name="usdRate"
        label="Курс долара за місяць, ₴"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={state.values?.usdRate ?? (rate === null ? "" : String(rate))}
        required
      />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
        Зберегти курс
      </MainButton>
    </Form>
  );
}

export function CommissionForm({
  action,
  month,
  manager,
}: ScopedProps & { manager: MonthPageData["managers"][number] }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="profileId" value={manager.profileId} />
      <CustomizedInput
        name="ratePerKg"
        label={`${manager.name}, ₴ за кг`}
        inputMode="decimal"
        autoComplete="off"
        defaultValue={state.values?.ratePerKg ?? shown(manager.rate)}
        hint="Діє з цього місяця й надалі, доки не зміните. Нуль: без комісійних."
        required
      />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
        Зберегти ставку
      </MainButton>
    </Form>
  );
}

export function CategoryForm({
  action,
  category,
}: {
  action: FormAction;
  category: MonthPageData["categories"][number];
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="id" value={category.id} />
      <Checkbox
        name="repeatsMonthly"
        label="Однакова щомісяця"
        defaultChecked={category.repeatsMonthly}
      />
      <Checkbox name="isActive" label="Показувати у формі" defaultChecked={category.isActive} />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
        Зберегти статтю
      </MainButton>
    </Form>
  );
}

export function NewCategoryForm({ action }: { action: FormAction }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <CustomizedInput
        name="name"
        label="Назва нової статті"
        autoComplete="off"
        defaultValue={state.values?.name ?? ""}
        required
      />
      <CustomizedSelect
        name="kind"
        label="Що це"
        options={[
          { value: "expense", label: "Витрата" },
          { value: "income", label: "Інший дохід" },
        ]}
        defaultValue={state.values?.kind ?? "expense"}
      />
      <Checkbox name="repeatsMonthly" label="Однакова щомісяця" />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Додаємо…">
        Додати статтю
      </MainButton>
    </Form>
  );
}

/** Закрити чи відкрити місяць. */
export function MonthStateForm({
  action,
  month,
  label,
  hint,
}: ScopedProps & { label: string; hint: string }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="month" value={month} />
      <p className="text-body text-grey-text">{hint}</p>
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зачекайте…">
        {label}
      </MainButton>
    </Form>
  );
}
