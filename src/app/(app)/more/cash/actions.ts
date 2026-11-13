"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { recordCashEntry, reverseCashEntry } from "@/server/cash";
import { ValidationError } from "@/server/errors";
import { readOptionalText, readText, runFormAction } from "@/server/form-state";
import type { FormState } from "@/utils/formState";

/**
 * Дії готівки (B6, D67–D69): запис прийнятої готівки і сторно. Права, локацію й правила перевіряють
 * серверні функції; тут лише читаємо поля форми й оновлюємо екрани.
 */

function refresh() {
  revalidatePath("/more/cash");
  revalidatePath("/orders", "layout");
  revalidatePath("/production", "layout");
}

function readId(formData: FormData, name: string, message: string): string {
  const parsed = z.uuid().safeParse(readText(formData, name));
  if (!parsed.success) throw new ValidationError(message);
  return parsed.data;
}

/** «Прийнято готівку»: сума, хто прийняв, примітка. Більше залишку приймати не можна. */
export async function recordCashEntryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    amount: readText(formData, "amount"),
    receivedBy: readText(formData, "receivedBy"),
    note: readText(formData, "note"),
  };
  return runFormAction(
    async () => {
      await recordCashEntry(getDb(), actor, {
        orderId: readId(formData, "orderId", "Замовлення не знайдено."),
        amount: values.amount,
        receivedBy: readOptionalText(formData, "receivedBy"),
        note: readOptionalText(formData, "note"),
      });
      refresh();
    },
    { success: "Готівку записано.", values },
  );
}

/** Сторно запису готівки: лише власник, причина обов'язкова. */
export async function reverseCashEntryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { reason: readText(formData, "reason") };
  return runFormAction(
    async () => {
      await reverseCashEntry(
        getDb(),
        actor,
        readId(formData, "entryId", "Запис не знайдено."),
        values.reason,
      );
      refresh();
    },
    { success: "Запис сторновано.", values },
  );
}
