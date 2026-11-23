import { and, eq, inArray } from "drizzle-orm";
import { boxTypes, orderItems } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { ValidationError } from "./errors";
import { parsePricePerKg } from "./price-rules";
import { productIdByCode, resolveBoxPrice } from "./product-prices";

/**
 * Продаж боксів у замовленні (Роман, 20.11.2026, D174): окремі позиції «Бокс <тип> × кількість» з
 * ціною (з прайсу боксів на дату замовлення або вказана вручну). Замовлення може складатися лише з
 * таких позицій, без льоду. Це не те саме, що тара, яку видаємо разом з льодом (`order_boxes`).
 */

export type BoxSaleInput = {
  boxTypeId: string;
  qty: number;
  /** Ціна за штуку: порожня означає «взяти з прайсу боксів». */
  price?: string | number | null;
};

export type PreparedBoxSale = {
  boxTypeId: string;
  title: string;
  qty: number;
  price: string;
};

/** Перевіряє типи боксів і визначає ціну кожної позиції. */
export async function prepareBoxSales(
  db: AnyPgDatabase,
  sales: BoxSaleInput[],
  date: string,
): Promise<PreparedBoxSale[]> {
  if (sales.length === 0) return [];
  const ids = [...new Set(sales.map((sale) => sale.boxTypeId))];
  const types = await db
    .select({
      id: boxTypes.id,
      name: boxTypes.name,
      isClientOwned: boxTypes.isClientOwned,
      kind: boxTypes.kind,
    })
    .from(boxTypes)
    .where(inArray(boxTypes.id, ids));
  const byId = new Map(types.map((type) => [type.id, type]));
  const merged = new Map<string, PreparedBoxSale>();
  for (const sale of sales) {
    const type = byId.get(sale.boxTypeId);
    if (!type) throw new ValidationError("Тип бокса не знайдено.");
    if (type.isClientOwned) throw new ValidationError("Бокси клієнтів ми не продаємо.");
    if (type.kind === "dewar") throw new ValidationError("Сосуди Дюара ми не продаємо.");
    if (!Number.isInteger(sale.qty) || sale.qty < 1 || sale.qty > 10_000) {
      throw new ValidationError("Кількість боксів на продаж має бути цілим числом від 1.");
    }
    const manual =
      sale.price === undefined || sale.price === null || String(sale.price).trim() === ""
        ? null
        : parsePricePerKg(sale.price);
    const price = manual ?? (await resolveBoxPrice(db, type.id, date)) ?? "0.00";
    // Однакові бокси за однаковою ціною зливаємо в один рядок.
    const key = `${type.id}|${price}`;
    const existing = merged.get(key);
    if (existing) existing.qty += sale.qty;
    else merged.set(key, { boxTypeId: type.id, title: `Бокс ${type.name}`, qty: sale.qty, price });
  }
  return [...merged.values()];
}

/** Замінює позиції продажу боксів замовлення (в межах транзакції збереження). */
export async function saveBoxSaleItems(
  tx: AnyPgDatabase,
  orderId: string,
  sales: PreparedBoxSale[],
): Promise<void> {
  await tx
    .delete(orderItems)
    .where(and(eq(orderItems.orderId, orderId), eq(orderItems.kind, "box_sale")));
  if (sales.length === 0) return;
  const productId = await productIdByCode(tx, "box");
  await tx.insert(orderItems).values(
    sales.map((sale) => ({
      orderId,
      kind: "box_sale" as const,
      title: sale.title,
      qty: String(sale.qty),
      unit: "шт",
      price: sale.price,
      boxTypeId: sale.boxTypeId,
      productId,
    })),
  );
}
