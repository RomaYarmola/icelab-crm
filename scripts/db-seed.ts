import "./_load-env";
import { closeSql, getDb } from "@/db/client";
import { seedReferenceData } from "@/db/seed";
import { getEnv } from "@/env";

async function main() {
  const { APP_ENV } = getEnv();
  console.log(`Початкові дані довідників, середовище: ${APP_ENV}`);

  const added = await seedReferenceData(getDb());
  for (const [table, count] of Object.entries(added)) {
    console.log(`  ${table}: додано ${count}`);
  }
  console.log("Готово. Повторний запуск нічого не змінить.");
}

main()
  .catch((error: unknown) => {
    console.error("Помилка:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
