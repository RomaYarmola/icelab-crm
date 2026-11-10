import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { EnvError, getSupabaseEnv } from "@/env";

/**
 * Оновлення сесії на кожному запиті (викликається з `src/proxy.ts`) і швидка перевірка,
 * чи користувач увійшов. База даних тут не опитується: детальні перевірки (профіль, роль,
 * чи активний) робить шар доступу біля даних (`src/server/auth.ts`).
 *
 * Сесію оновлюємо лише тут. Якщо оновлювати ще й деінде, Supabase може вважати це повторним
 * використанням токена і викинути користувача з системи.
 */

/**
 * Сторінки, доступні без входу: форма входу, повернення з Google (там сесію ще створюють)
 * і завершення сесії. `/api/health` обробляємо окремо: він не залежить від Supabase.
 */
const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/end-session"];

/** Ці заголовки Supabase просить додати до відповіді, що ставить cookie сесії (заборона кешування). */
const CACHE_HEADERS = ["cache-control", "expires", "pragma"];

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/health") return NextResponse.next({ request });

  let env: ReturnType<typeof getSupabaseEnv>;
  try {
    env = getSupabaseEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      // Лише імена змінних, без значень.
      return new NextResponse(
        `Вхід не налаштовано: перевірте змінні середовища ${error.variables.join(", ")}.`,
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    throw error;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // getClaims перевіряє підпис токена і оновлює його, коли термін майже вичерпано.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (!signedIn && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return withSessionCookies(
        NextResponse.json({ error: "Потрібен вхід." }, { status: 401 }),
        response,
      );
    }
    return withSessionCookies(redirectTo(request, "/login"), response);
  }
  if (signedIn && pathname === "/login" && !request.nextUrl.searchParams.has("reason")) {
    return withSessionCookies(redirectTo(request, "/me"), response);
  }
  return response;
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  return NextResponse.redirect(url);
}

/** Переносить на іншу відповідь оновлені cookie сесії й заголовки заборони кешування. */
function withSessionCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  for (const name of CACHE_HEADERS) {
    const value = source.headers.get(name);
    if (value) target.headers.set(name, value);
  }
  return target;
}
