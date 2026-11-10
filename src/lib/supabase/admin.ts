import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "@/env";
import type { AuthAdmin } from "@/server/users";

/** Заборона входу «назавжди» (100 років): Supabase приймає лише тривалість, а не дату. */
const BAN_FOREVER = "876000h";

/**
 * Адміністративний доступ до Supabase Auth із секретним ключем: створення акаунтів, пароль,
 * заборона входу. ЛИШЕ НА СЕРВЕРІ: секретний ключ дає повний доступ і не має потрапляти
 * в браузер (змінна без префікса NEXT_PUBLIC_, тому Next.js не вбудовує її в код для браузера).
 */
export function createSupabaseAuthAdmin(): AuthAdmin {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret } = getSupabaseAdminEnv();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async createUser({ email, password }) {
      // email_confirm: пошту не підтверджуємо листом (листів немає), акаунт одразу робочий.
      // Без пароля акаунт працює лише для входу через Google: Supabase з'єднає його з Google
      // за тією самою перевіреною адресою.
      const { data, error } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        ...(password ? { password } : {}),
      });
      if (error || !data.user) {
        throw new Error(`Supabase: не вдалося створити акаунт (${error?.status ?? "?"}).`);
      }
      return { id: data.user.id };
    },
    async deleteUser(id) {
      const { error } = await client.auth.admin.deleteUser(id);
      if (error) throw new Error(`Supabase: не вдалося видалити акаунт (${error.status ?? "?"}).`);
    },
    async setPassword(id, password) {
      const { error } = await client.auth.admin.updateUserById(id, { password });
      if (error) throw new Error(`Supabase: не вдалося змінити пароль (${error.status ?? "?"}).`);
    },
    async setBanned(id, banned) {
      const { error } = await client.auth.admin.updateUserById(id, {
        ban_duration: banned ? BAN_FOREVER : "none",
      });
      if (error) {
        throw new Error(`Supabase: не вдалося змінити заборону входу (${error.status ?? "?"}).`);
      }
    },
  };
}
