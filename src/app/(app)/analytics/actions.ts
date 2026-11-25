"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { readText, runFormAction } from "@/server/form-state";
import { setClientOneTime, setInactiveDays } from "@/server/inactive";
import { dismissReminder, setBoxReminderDays, setReturnReminderDays } from "@/server/reminders";
import type { FormState } from "@/utils/formState";

/** Дії аналітики (B14): позначка «Разовий клієнт» і загальний поріг. Права перевіряє сервер. */

function refresh() {
  revalidatePath("/analytics");
  revalidatePath("/clients", "layout");
}

export async function markOneTimeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await setClientOneTime(getDb(), actor, readText(formData, "clientId"), true);
      refresh();
    },
    { success: "Клієнта позначено разовим." },
  );
}

export async function saveInactiveDaysAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { days: readText(formData, "days") };
  return runFormAction(
    async () => {
      await setInactiveDays(getDb(), actor, Number(values.days.trim()));
      refresh();
    },
    { success: "Поріг збережено.", values },
  );
}

/** «Відкласти» нагадування (своє). */
export async function dismissReminderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await dismissReminder(getDb(), actor, readText(formData, "reminderId"));
      refresh();
    },
    { success: "Відкладено." },
  );
}

/** Через скільки днів нагадувати про бокс у клієнта (власник). */
export async function saveBoxDaysAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { days: readText(formData, "days") };
  return runFormAction(
    async () => {
      await setBoxReminderDays(getDb(), actor, Number(values.days.trim()));
      refresh();
    },
    { success: "Поріг збережено.", values },
  );
}

/** Через скільки днів нагадувати про повернення боксу, що чекає на пошті (власник, B17). */
export async function saveReturnDaysAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { days: readText(formData, "days") };
  return runFormAction(
    async () => {
      await setReturnReminderDays(getDb(), actor, Number(values.days.trim()));
      refresh();
    },
    { success: "Поріг збережено.", values },
  );
}
