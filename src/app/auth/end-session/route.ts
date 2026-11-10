import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthFailure } from "@/server/sign-in";

export const dynamic = "force-dynamic";

/**
 * Завершує сесію користувача, якого не можна пускати (вимкнений, без профілю, водій),
 * і веде на сторінку входу з поясненням. Route Handler може прибрати cookie, на відміну від
 * Server Component, тому `requireUser()` перенаправляє сюди. Параметр `reason` перевіряємо
 * за списком відомих причин: у сторінку входу інший текст потрапити не може.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const reason = url.searchParams.get("reason");
  const target = new URL("/login", url);
  if (isAuthFailure(reason)) target.searchParams.set("reason", reason);
  return NextResponse.redirect(target);
}
