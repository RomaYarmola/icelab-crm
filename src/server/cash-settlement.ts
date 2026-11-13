import { eq, sql } from "drizzle-orm";
import { cashEntries, orders, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import {
  canSettleByCash,
  type CashSummary,
  DEFAULT_CASH_TOLERANCE_UAH,
  summarizeCash,
} from "./cash-rules";

/**
 * Зв'язок готівки зі статусом замовлення (D67, ТЗ 5.1): коли прийнято всю суму, а замовлення вже
 * відправлене (чи самовивіз запакований), система сама ставить «Оплачено». Функції працюють усередині
 * чужої транзакції із заблокованим замовленням: самі транзакції не відкривають. Окремий модуль, щоб
 * `order-status.ts` (переходи) і `cash.ts` (записи) не залежали одне від одного по колу.
 */

type OrderRow = typeof orders.$inferSelect;

export const CASH_TOLERANCE_KEY = "payment.amount_tolerance_uah";

/** Примітка в історії статусів, коли «Оплачено» поставила готівка. */
export const CASH_PAID_NOTE = "Оплачено автоматично: готівку прийнято повністю";

/** Допуск суми, грн (`payment.amount_tolerance_uah`, за замовчуванням 5). */
export async function loadCashTolerance(db: AnyPgDatabase): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, CASH_TOLERANCE_KEY))
    .limit(1);
  const value = row?.value;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_CASH_TOLERANCE_UAH;
}

/** Підсумок готівки по замовленню за записами в базі (сторновані не рахуються). */
export async function loadCashSummary(
  db: AnyPgDatabase,
  order: Pick<OrderRow, "id" | "total">,
  toleranceUah?: number,
): Promise<CashSummary> {
  const rows = await db
    .select({ amount: cashEntries.amount, reversedAt: cashEntries.reversedAt })
    .from(cashEntries)
    .where(eq(cashEntries.orderId, order.id));
  return summarizeCash(
    order.total,
    rows.map((row) => ({ amount: row.amount, reversed: row.reversedAt !== null })),
    toleranceUah ?? (await loadCashTolerance(db)),
  );
}

/**
 * Ставить «Оплачено», якщо готівку прийнято повністю і статус це дозволяє (із «Відправлено», для
 * самовивозу ще із «Запаковано»). Викликати в транзакції після блокування замовлення; `order` це
 * його актуальний рядок. Повертає, чи статус змінено.
 */
export async function settleCashPayment(db: AnyPgDatabase, order: OrderRow): Promise<boolean> {
  if (order.deletedAt || order.paymentKind !== "cash") return false;
  if (!canSettleByCash(order.status, order.deliveryMethod)) return false;
  const summary = await loadCashSummary(db, order);
  if (!summary.paid) return false;
  // Запис в історії статусів: чому замовлення оплачене (примітку читає тригер бази).
  await db.execute(sql`select set_config('app.change_note', ${CASH_PAID_NOTE}, true)`);
  await db
    .update(orders)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(orders.id, order.id));
  return true;
}
