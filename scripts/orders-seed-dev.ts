import "./_load-env";
import { parseArgs } from "node:util";
import { closeSql, getDb } from "@/db/client";
import { getEnv } from "@/env";
import { findOwnerActor } from "./_demo-clients";
import { addDemoOrders, DEMO_ORDER_MARK, removeDemoOrders } from "./_demo-orders";

// Додає (або видаляє) демонстраційні замовлення для перевірки екранів «Замовлення». Лише для APP_ENV=dev.
// Спершу потрібні демо-клієнти. База одна з Production (D22): запускайте лише після «так» розробника.
//
//   npm run orders:seed-dev            додати близько 18 замовлень у різних статусах і на різні дні
//   npm run orders:seed-dev -- --remove видалити всі замовлення з позначкою «Тест: демо-замовлення»

async function main() {
  const { values } = parseArgs({ options: { remove: { type: "boolean" } } });

  const { APP_ENV } = getEnv();
  if (APP_ENV !== "dev") {
    throw new Error(
      `Демонстраційні замовлення можна додавати лише для APP_ENV=dev, зараз: ${APP_ENV}.`,
    );
  }
  const db = getDb();

  if (values.remove) {
    const { removed } = await removeDemoOrders(db);
    console.log(`Видалено демонстраційних замовлень («${DEMO_ORDER_MARK}»): ${removed}.`);
    return;
  }

  const result = await addDemoOrders(db, await findOwnerActor(db));
  if (result.skipped) {
    console.log(
      "Демонстраційні замовлення вже є. Щоб додати заново, спершу: npm run orders:seed-dev -- --remove",
    );
  } else {
    console.log(
      `Додано демонстраційних замовлень: ${result.added}. Видалити: npm run orders:seed-dev -- --remove`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error("Помилка:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
