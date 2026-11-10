import "./_load-env";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { closeSql, getDb } from "@/db/client";
import { locations } from "@/db/schema";
import { getEnv } from "@/env";
import { createSupabaseAuthAdmin } from "@/lib/supabase/admin";
import { USER_ROLES, type UserRole } from "@/server/permissions";
import { provisionUser } from "@/server/users";
import { generatePassword, PASSWORDS_FILE, savePassword } from "./_user-passwords";

// Створює одного користувача: акаунт у Supabase Auth і профіль у нашій базі.
// Потрібен, щоб завести першого власника, коли в системі ще нікого немає.
//
// За замовчуванням пароль генерується і записується у файл .dev-users.local (у консоль не
// виводиться). З прапорцем --no-password акаунт створюється без пароля: людина входитиме лише
// через Google, використовуючи ту саму адресу Gmail.
//
//   npm run user:create -- --email=roman@gmail.com --name="Роман" --role=owner
//   npm run user:create -- --email=oleksii@gmail.com --name="Олексій" --role=manager --no-password
//   npm run user:create -- --email=lead@example.com --name="Старший" --role=location_lead --location=kyiv
//
// У середовищі, відмінному від dev, потрібен ще прапорець --yes.

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      location: { type: "string" },
      "no-password": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });

  const { APP_ENV } = getEnv();
  if (APP_ENV !== "dev" && !values.yes) {
    throw new Error(
      `Середовище ${APP_ENV}, не dev. Це створить справжнього користувача. Додайте прапорець --yes.`,
    );
  }
  if (!values.email || !values.name || !values.role) {
    throw new Error(
      'Потрібні параметри --email, --name і --role. Приклад: --email=a@b.com --name="Ім\'я" --role=owner',
    );
  }
  if (!USER_ROLES.includes(values.role as UserRole)) {
    throw new Error(`Невідома роль «${values.role}». Доступні: ${USER_ROLES.join(", ")}.`);
  }

  const db = getDb();
  let locationId: string | null = null;
  if (values.location) {
    const [location] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.code, values.location));
    if (!location) throw new Error(`Локацію з кодом «${values.location}» не знайдено.`);
    locationId = location.id;
  }

  const password = values["no-password"] ? undefined : generatePassword();
  const profile = await provisionUser({ db, admin: createSupabaseAuthAdmin() }, null, {
    email: values.email,
    password,
    fullName: values.name,
    role: values.role as UserRole,
    locationId,
  });

  console.log(`Створено: ${values.email}, роль ${profile.role} (середовище ${APP_ENV}).`);
  if (password) {
    savePassword({ email: values.email, role: profile.role, password, env: APP_ENV });
    console.log(`Пароль записано у файл ${PASSWORDS_FILE}.`);
  } else {
    console.log("Пароля немає: вхід лише через Google.");
  }
}

main()
  .catch((error: unknown) => {
    console.error("Помилка:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
