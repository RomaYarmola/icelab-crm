"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { readText, runFormAction } from "@/server/form-state";
import { confirmIntakeDraft, rejectIntakeDraft } from "@/server/intake/drafts";
import type { FormState } from "@/utils/formState";

/**
 * Дії вкладки «Чернетки» (B11). Права й правила перевіряють серверні функції: підтвердження йде тими
 * самими правилами, що й у кнопці Telegram (клієнт обов'язковий, ціна за прайсом).
 */

/** «Підтвердити» чернетку. */
export async function confirmDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const orderId = readText(formData, "orderId");
  return runFormAction(
    async () => {
      await confirmIntakeDraft(getDb(), actor, orderId);
      revalidatePath("/orders", "layout");
      revalidatePath("/production", "layout");
    },
    { success: "Підтверджено: замовлення з'явилось у виробництві." },
  );
}

/** «Відхилити» чернетку (поле `id`, як у `DeleteRecordForm`). */
export async function rejectDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const orderId = readText(formData, "id");
  return runFormAction(
    async () => {
      await rejectIntakeDraft(getDb(), actor, orderId);
      revalidatePath("/orders", "layout");
    },
    { success: "Чернетку відхилено." },
  );
}
