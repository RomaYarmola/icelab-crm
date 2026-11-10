import "./_load-env";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { closeSql, getDb } from "@/db/client";
import { locations } from "@/db/schema";
import { getEnv } from "@/env";
import { createSupabaseAuthAdmin } from "@/lib/supabase/admin";
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/server/permissions";
import { provisionUser } from "@/server/users";
import { generatePassword, PASSWORDS_FILE, savePassword } from "./_user-passwords";

// Створює в dev по одному тестовому користувачу на кожну роль, щоб перевірити вхід і права.
// Паролі генеруються і записуються у файл .dev-users.local (у консоль не виводяться).
// Лише для APP_ENV=dev.
//
//   npm run user:seed-dev -- --email-template="ваша.пошта+{role}@gmail.com"
//
// У шаблоні {role} замінюється на код ролі (owner, manager, location_lead, production,
// accountant, driver). Підходить будь-яка адреса, що не збігається з уже наявною в Supabase.
// Gmail доставляє «ім'я+щось@gmail.com» у ту саму скриньку, але листів система й так не надсилає.

/** Локація для ролей, у яких вона обов'язкова: старший у Києві, виробництво й водій у Львові. */
const LOCATION_BY_ROLE: Partial<Record<UserRole, string>> = {
  location_lead: "kyiv",
  production: "lviv",
  driver: "lviv",
};

async function main() {
  const { values } = parseArgs({ options: { "email-template": { type: "string" } } });
  const template = values["email-template"];
  if (!template?.includes("{role}")) {
    throw new Error(
      'Потрібен параметр --email-template із {role}, наприклад "a+{role}@gmail.com".',
    );
  }

  const { APP_ENV } = getEnv();
  if (APP_ENV !== "dev") {
    throw new Error(
      `Тестових користувачів можна створювати лише для APP_ENV=dev, зараз: ${APP_ENV}.`,
    );
  }

  const db = getDb();
  const admin = createSupabaseAuthAdmin();

  for (const role of USER_ROLES) {
    const email = template.replaceAll("{role}", role);
    try {
      let locationId: string | null = null;
      const locationCode = LOCATION_BY_ROLE[role];
      if (locationCode) {
        const [location] = await db
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.code, locationCode));
        if (!location)
          throw new Error(`немає локації «${locationCode}» (запустіть npm run db:seed)`);
        locationId = location.id;
      }

      const password = generatePassword();
      await provisionUser({ db, admin }, null, {
        email,
        password,
        fullName: `Тест: ${ROLE_LABELS[role]}`,
        role,
        locationId,
      });
      savePassword({ email, role, password, env: APP_ENV });
      console.log(`Створено: ${email} (${role})`);
    } catch (error) {
      console.log(
        `Пропущено ${email} (${role}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  console.log(`\nПаролі записано у файл ${PASSWORDS_FILE}.`);
}

main()
  .catch((error: unknown) => {
    console.error("Помилка:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
