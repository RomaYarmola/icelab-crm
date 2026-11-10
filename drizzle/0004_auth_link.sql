-- B2: профіль користувача 1 до 1 з акаунтом Supabase Auth (закриває рішення D11).
-- Зв'язок задано вручну: таблиця auth.users належить Supabase, тому в схемі Drizzle її немає,
-- а drizzle-kit не бачить цього обмеження і не пропонуватиме його видалити.
-- Видалення акаунта, на який є профіль, заборонено: користувачів вимикаємо (is_active), а не видаляємо.
ALTER TABLE "profiles"
	ADD CONSTRAINT "profiles_id_auth_users_fk"
	FOREIGN KEY ("id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
