import "./_load-env";
import { parseArgs } from "node:util";
import { closeSql, getDb } from "@/db/client";
import { getEnv } from "@/env";
import { findOwnerActor } from "./_demo-clients";
import {
  addDemoCash,
  addDemoOrders,
  DEMO_CASH_MARK,
  DEMO_ORDER_MARK,
  removeDemoOrders,
} from "./_demo-orders";

// Додає (або видаляє) демонстраційні замовлення для перевірки екранів «Замовлення». Лише для APP_ENV=dev.
// Спершу потрібні демо-клієнти. База одна з Production (D22): запускайте лише після «так» розробника.
//
//   npm run orders:seed-dev            додати близько 18 замовлень у різних статусах і на різні дні
//   npm run orders:seed-dev -- --cash  додати 5 замовлень з готівкою й записи готівки (B6)
//   npm run orders:seed-dev -- --remove видалити всі демо-замовлення («Тест: демо-замовлення»,
//                                       «Тест: демо-готівка») разом із записами готівки

async function main() {
  const { values } = parseArgs({
    options: { remove: { type: "boolean" }, cash: { type: "boolean" } },
  });

  const { APP_ENV } = getEnv();
  if (APP_ENV !== "dev") {
    throw new Error(
      `Демонстраційні замовлення можна додавати лише для APP_ENV=dev, зараз: ${APP_ENV}.`,
    );
  }
  const db = getDb();

  if (values.remove) {
    const { removed } = await removeDemoOrders(db);
    console.log(
      `Видалено демонстраційних замовлень («${DEMO_ORDER_MARK}», «${DEMO_CASH_MARK}»): ${removed}.`,
    );
    return;
  }

  if (values.cash) {
    const cash = await addDemoCash(db, await findOwnerActor(db));
    console.log(
      cash.skipped
        ? "Демонстраційна готівка вже є. Щоб додати заново, спершу: npm run orders:seed-dev -- --remove"
        : `Додано замовлень з готівкою: ${cash.added}, записів готівки: ${cash.entries}. Видалити: npm run orders:seed-dev -- --remove`,
    );
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
