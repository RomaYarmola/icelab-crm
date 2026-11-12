"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createSupabaseAuthAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readText, runFormAction } from "@/server/form-state";
import type { FormState } from "@/utils/formState";
import type { UserRole } from "@/server/permissions";
import {
  createUserAccount,
  resetUserPassword,
  setUserActive,
  updateUserProfile,
} from "@/server/users";

/**
 * Дії екрана «Користувачі» (лише власник: права перевіряє `server/users.ts`). Кожна дія читає поля
 * форми, викликає функцію керування користувачами і повертає стан для екрана.
 */

function deps() {
  return { db: getDb(), admin: createSupabaseAuthAdmin() };
}

/** Ідентифікатор користувача з прихованого поля форми. */
function readUserId(formData: FormData): string {
  const parsed = z.uuid().safeParse(readText(formData, "id"));
  if (!parsed.success) throw new ValidationError("Користувача не знайдено.");
  return parsed.data;
}

/** Порожній рядок із форми означає «немає значення». */
function orNull(value: string): string | null {
  return value === "" ? null : value;
}

/** Значення полів профілю для повернення у форму при помилці (без паролів). */
function profileValues(formData: FormData) {
  return {
    fullName: readText(formData, "fullName"),
    role: readText(formData, "role"),
    locationId: readText(formData, "locationId"),
    phone: readText(formData, "phone"),
  };
}

export async function createUserAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { ...profileValues(formData), email: readText(formData, "email") };
  let createdId: string | undefined;

  const state = await runFormAction(
    async () => {
      const profile = await createUserAccount(deps(), actor, {
        email: values.email,
        // Без пароля користувач входитиме лише через Google.
        password: orNull(readText(formData, "password")) ?? undefined,
        fullName: values.fullName,
        // Значення перевіряє схема всередині createUserAccount.
        role: values.role as UserRole,
        locationId: orNull(values.locationId),
        phone: orNull(values.phone),
      });
      createdId = profile.id;
    },
    { success: "Користувача створено.", values },
  );

  if (createdId) {
    revalidatePath("/more", "layout");
    redirect(`/more/users/${createdId}?created=1`);
  }
  return state;
}

export async function updateUserAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = profileValues(formData);

  return runFormAction(
    async () => {
      await updateUserProfile(deps(), actor, readUserId(formData), {
        fullName: values.fullName,
        role: values.role as UserRole,
        locationId: orNull(values.locationId),
        phone: orNull(values.phone),
      });
      revalidatePath("/more", "layout");
    },
    { success: "Зміни збережено.", values },
  );
}

export async function setUserActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const active = readText(formData, "active") === "1";

  return runFormAction(
    async () => {
      await setUserActive(deps(), actor, readUserId(formData), active);
      revalidatePath("/more", "layout");
    },
    { success: active ? "Користувача увімкнено." : "Користувача вимкнено." },
  );
}

export async function resetPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const password = readText(formData, "password");
  const confirm = readText(formData, "confirm");

  return runFormAction(
    async () => {
      if (password !== confirm) throw new ValidationError("Паролі не збігаються.");
      await resetUserPassword(deps(), actor, readUserId(formData), password);
    },
    { success: "Новий пароль задано. Повідомте його користувачу." },
  );
}
