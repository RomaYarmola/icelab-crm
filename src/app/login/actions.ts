"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { originFromHeaders } from "@/lib/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signInWithPassword } from "@/server/sign-in";

export type SignInFormState = { message?: string };

/** Вхід за e-mail і паролем. Успіх веде на `/me`, помилка повертає повідомлення для форми. */
export async function signInAction(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const supabase = await createSupabaseServerClient();
  const result = await signInWithPassword(
    supabase.auth,
    getDb(),
    { email: formData.get("email"), password: formData.get("password") },
    { ip: clientIpFromHeaders(await headers()) },
  );
  if (!result.ok) return { message: result.message };
  redirect("/me");
}

/**
 * Вхід через Google: відправляє користувача на сторінку Google. Після згоди Google повертає його
 * в Supabase, а той на `/auth/callback` нашого застосунку (див. `app/auth/callback/route.ts`).
 */
export async function signInWithGoogleAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const origin = originFromHeaders(await headers());

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      // Якщо в браузері кілька Google-акаунтів, даємо вибрати потрібний.
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/login?reason=google_failed");
  redirect(data.url);
}

/** Вихід із системи. */
export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
