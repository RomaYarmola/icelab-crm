"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readText, runFormAction } from "@/server/form-state";
import type { FormState } from "@/utils/formState";
import { changeOwnPassword } from "@/server/users";

/**
 * Зміна власного пароля зі сторінки «Ще». Працює через сесію самого користувача, тож чужий
 * пароль так не змінити. Паролі лишаємо в полях лише на час відправки: у стан форми їх не повертаємо.
 */
export async function changePasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const password = readText(formData, "password");
  const confirm = readText(formData, "confirm");

  return runFormAction(
    async () => {
      if (password !== confirm) throw new ValidationError("Паролі не збігаються.");
      const supabase = await createSupabaseServerClient();
      await changeOwnPassword(supabase.auth, password);
    },
    { success: "Пароль змінено." },
  );
}
