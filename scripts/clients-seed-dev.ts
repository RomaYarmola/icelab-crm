import "./_load-env";
import { parseArgs } from "node:util";
import { closeSql, getDb } from "@/db/client";
import { getEnv } from "@/env";
import { addDemoClients, DEMO_PREFIX, findOwnerActor, removeDemoClients } from "./_demo-clients";

// Додає (або видаляє) демонстраційних клієнтів для перевірки екранів «Клієнти». Лише для APP_ENV=dev.
// База одна з Production (D22), тому запускайте лише після «так» розробника.
//
//   npm run clients:seed-dev            додати близько 15 клієнтів «Тест: …»
//   npm run clients:seed-dev -- --bulk  додати ще 35, щоб перевірити «Показати ще»
//   npm run clients:seed-dev -- --remove видалити всіх клієнтів «Тест: …» з їхніми контактами і цінами

async function main() {
  const { values } = parseArgs({
    options: { remove: { type: "boolean" }, bulk: { type: "boolean" } },
  });

  const { APP_ENV } = getEnv();
  if (APP_ENV !== "dev") {
    throw new Error(
      `Демонстраційних клієнтів можна додавати лише для APP_ENV=dev, зараз: ${APP_ENV}.`,
    );
  }
  const db = getDb();

  if (values.remove) {
    const { removed, kept } = await removeDemoClients(db);
    console.log(`Видалено клієнтів «${DEMO_PREFIX} …»: ${removed}.`);
    if (kept > 0) console.log(`Лишилось ${kept}: на них уже є замовлення, видаліть їх вручну.`);
    return;
  }

  const result = await addDemoClients(db, await findOwnerActor(db), { bulk: values.bulk });
  if (result.skipped) {
    console.log(
      `Демонстраційні клієнти вже є. Щоб додати заново, спершу: npm run clients:seed-dev -- --remove`,
    );
  } else {
    console.log(
      `Додано демонстраційних клієнтів: ${result.added}. Видалити: npm run clients:seed-dev -- --remove`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error("Помилка:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
