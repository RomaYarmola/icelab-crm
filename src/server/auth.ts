import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthError, type AuthFailure, resolveAppUser } from "./current-user";
import { type AppUser, type PermissionScope, requirePermission } from "./guards";
import type { AccessKind, Resource } from "./permissions";

/**
 * Шар доступу до даних: єдине місце на сервері, яке відповідає на питання «хто це».
 * Кожна сторінка, серверна дія й обробник API починають з `requireUser()` або
 * `requirePermittedUser()`.
 */

type AuthState =
  | { status: "ok"; user: AppUser }
  | { status: "anonymous" }
  | { status: "rejected"; reason: AuthFailure };

/** Стан входу для поточного запиту (запам'ятовується на час одного запиту). */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createSupabaseServerClient();
  // getClaims перевіряє підпис токена. getSession на сервері не використовуємо:
  // його даним довіряти не можна.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { status: "anonymous" };

  try {
    const user = await resolveAppUser(getDb(), { sub: claims.sub, email: claims.email });
    return { status: "ok", user };
  } catch (error) {
    if (error instanceof AuthError) return { status: "rejected", reason: error.reason };
    throw error;
  }
});

/** Користувач запиту або `null`, якщо він не увійшов чи його не можна пускати. */
export async function getCurrentUser(): Promise<AppUser | null> {
  const state = await getAuthState();
  return state.status === "ok" ? state.user : null;
}

/**
 * Користувач запиту. Якщо не увійшов, переходить на `/login`. Якщо сесія є, але профіль
 * відхилено (вимкнений, без профілю, водій), завершує сесію окремим маршрутом
 * `/auth/end-session`: Server Component не може сам прибрати cookie, і без цього
 * `/login` і `/me` відправляли б користувача одне одному по колу.
 */
export async function requireUser(): Promise<AppUser> {
  const state = await getAuthState();
  if (state.status === "ok") return state.user;
  if (state.status === "rejected") redirect(`/auth/end-session?reason=${state.reason}`);
  redirect("/login");
}

/** Користувач запиту, у якого є право на ресурс за матрицею ТЗ. Інакше кидає ForbiddenError. */
export async function requirePermittedUser(
  resource: Resource,
  kind: AccessKind,
  scope?: PermissionScope,
): Promise<AppUser> {
  const user = await requireUser();
  requirePermission(user, resource, kind, scope);
  return user;
}
