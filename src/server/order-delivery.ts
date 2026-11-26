import { and, eq } from "drizzle-orm";
import { canChargeDelivery } from "@/constants/orders";
import { orderItems } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseDecimal } from "@/utils/orderMath";
import { ValidationError } from "./errors";
import { DEFAULT_UNIT } from "./order-item-schema";

/**
 * Платна доставка в замовленні (D235): одна позиція «Доставка» з сумою. Вона входить у суму
 * замовлення, тож потрапляє в готівку водія, оплати за номерами й підсумки. Для Нової Пошти
 * (клієнт платить перевізнику) і самовивозу її не буває.
 */

const MAX_DELIVERY_PRICE = 1_000_000;
const TITLE = "Доставка";

/** Порожнє чи нуль: платної доставки немає (`null`); інакше сума з копійками. */
export function parseDeliveryPrice(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined || String(input).trim() === "") return null;
  const value = typeof input === "number" ? input : parseDecimal(input);
  if (!Number.isFinite(value)) throw new ValidationError("Сума доставки має бути числом.");
  if (value < 0) throw new ValidationError("Сума доставки не може бути від'ємною.");
  if (value > MAX_DELIVERY_PRICE) {
    throw new ValidationError("Надто велика сума доставки: перевірте число.");
  }
  const price = value.toFixed(2);
  return price === "0.00" ? null : price;
}

export function assertDeliveryPriceAllowed(price: string | null, method: string) {
  if (price !== null && !canChargeDelivery(method)) {
    throw new ValidationError(
      "Платну доставку не вказуємо для Нової Пошти й самовивозу: приберіть суму.",
    );
  }
}

/**
 * Задає платну доставку замовлення (в межах транзакції збереження): замінює наявні позиції
 * «Доставка» однією або прибирає їх. Якщо сума та сама, нічого не переписує (журнал змін).
 */
export async function saveDeliveryItem(
  tx: AnyPgDatabase,
  orderId: string,
  price: string | null,
): Promise<void> {
  const where = and(eq(orderItems.orderId, orderId), eq(orderItems.kind, "delivery"));
  const current = await tx
    .select({ qty: orderItems.qty, price: orderItems.price })
    .from(orderItems)
    .where(where);
  const unchanged =
    price === null
      ? current.length === 0
      : current.length === 1 &&
        parseDecimal(current[0]!.qty) === 1 &&
        parseDecimal(current[0]!.price) === Number(price);
  if (unchanged) return;
  await tx.delete(orderItems).where(where);
  if (price === null) return;
  await tx.insert(orderItems).values({
    orderId,
    kind: "delivery",
    title: TITLE,
    qty: "1",
    unit: DEFAULT_UNIT.delivery,
    price,
  });
}
