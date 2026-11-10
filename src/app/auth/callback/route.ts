import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { originFromHeaders } from "@/lib/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { completeGoogleSignIn } from "@/server/sign-in";

export const dynamic = "force-dynamic";

/**
 * Сюди Supabase повертає користувача після входу через Google, з одноразовим кодом (`?code=`)
 * або з помилкою (`?error=`). Обмінюємо код на сесію (cookie ставить Supabase-клієнт), перевіряємо,
 * що для цього Google-акаунта є активний профіль, і веде на `/me`. Інакше сесію скасовано,
 * а на сторінці входу пояснення.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  let origin: string;
  try {
    origin = originFromHeaders(request.headers);
  } catch {
    origin = url.origin;
  }

  const supabase = await createSupabaseServerClient();
  const result = await completeGoogleSignIn(supabase.auth, getDb(), {
    code: url.searchParams.get("code"),
    providerError: url.searchParams.get("error"),
  });

  if (!result.ok) {
    return NextResponse.redirect(new URL(`/login?reason=${result.reason}`, origin));
  }
  return NextResponse.redirect(new URL("/me", origin));
}
