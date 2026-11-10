import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/env";

/**
 * Клієнт Supabase для коду на сервері (Server Components, Server Actions, Route Handlers).
 * Працює від імені користувача, чия сесія лежить у cookie цього запиту, тому створюємо його
 * заново на кожен запит і не зберігаємо між запитами.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key } =
    getSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component не може записувати cookie. Це нормально: сесію оновлює proxy.ts.
        }
      },
    },
  });
}
