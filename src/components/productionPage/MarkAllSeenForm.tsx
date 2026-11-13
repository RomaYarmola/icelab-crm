"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import FormMessage from "../shared/form/FormMessage";

interface MarkAllSeenFormProps {
  date: string;
  action: FormAction;
}

/** Кнопка «Позначити всі побаченими» (D65): знімає «Нове» з усіх замовлень дня. */
export default function MarkAllSeenForm({ date, action }: MarkAllSeenFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="date" value={date} />
      <FormMessage state={state} />
      <MainButton
        type="submit"
        variant="outline"
        size="sm"
        fullWidth={false}
        isLoading={isPending}
        loadingText="Зберігаємо…"
      >
        Позначити всі побаченими
      </MainButton>
    </form>
  );
}
