import "./_load-env";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeSql, getDb } from "@/db/client";
import { resetDatabase } from "@/db/reset";
import { seedReferenceData } from "@/db/seed";
import { getEnv } from "@/env";

// Очищає тестову базу, застосовує міграції і додає початкові дані.
// Відмовляється працювати, якщо середовище не dev або немає прапорця --yes.
async function main() {
  const { APP_ENV } = getEnv();
  if (APP_ENV !== "dev") {
    throw new Error(`Скидання бази дозволене лише для APP_ENV=dev, зараз: ${APP_ENV}.`);
  }
  if (!process.argv.includes("--yes")) {
    throw new Error("Це видалить усі дані в базі. Запустіть ще раз: npm run db:reset -- --yes");
  }

  const db = getDb();
  console.log("Видаляю таблиці, типи й функції...");
  await resetDatabase(db);
  console.log("Застосовую міграції...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Додаю початкові дані...");
  await seedReferenceData(db);
  console.log("Готово.");
}

main()
  .catch((error: unknown) => {
    console.error("Помилка:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
