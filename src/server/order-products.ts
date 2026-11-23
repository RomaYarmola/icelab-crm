import { and, eq, inArray, ne } from "drizzle-orm";
import { orderItems, products } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseDecimal } from "@/utils/orderMath";
import { ValidationError } from "./errors";
import { parsePricePerKg } from "./price-rules";
import { resolveProductPrice } from "./product-prices";

/**
 * Позиції товарів без типів у замовленні (D174, D176): рідкий азот (кг, ціна за кг, виробляє цех,
 * поштою не відправляємо). Одна позиція на товар, `kind = other`, з посиланням на товар.
 */

export type ProductLineInput = {
  qty: number | string;
  /** Ціна за одиницю: порожня означає «взяти з прайсу товару». */
  price?: string | number | null;
};

export type PreparedProductLine = {
  productId: string;
  code: string;
  title: string;
  unit: string;
  qty: string;
  price: string;
  allowedDeliveryMethods: string[] | null;
};

/** Перевіряє товар, кількість і визначає ціну (з прайсу на дату чи вручну). */
export async function prepareProductLine(
  db: AnyPgDatabase,
  code: string,
  input: ProductLineInput,
  date: string,
): Promise<PreparedProductLine> {
  const [product] = await db.select().from(products).where(eq(products.code, code));
  if (!product || !product.isActive) throw new ValidationError("Товар не знайдено.");
  const qty = typeof input.qty === "number" ? input.qty : parseDecimal(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ValidationError(`Вкажіть кількість: ${product.unit}, більше нуля.`);
  }
  if (qty > 100_000) throw new ValidationError("Забагато: перевірте число.");
  const manual =
    input.price === undefined || input.price === null || String(input.price).trim() === ""
      ? null
      : parsePricePerKg(input.price);
  const price = manual ?? (await resolveProductPrice(db, code, date)) ?? "0.00";
  return {
    productId: product.id,
    code,
    title: product.name,
    unit: product.unit,
    qty: qty.toFixed(3),
    price,
    allowedDeliveryMethods: product.allowedDeliveryMethods,
  };
}

/** Спосіб доставки має бути серед дозволених для товару (рідкий азот: лише самовивіз і власна). */
export function assertDeliveryAllowed(
  line: Pick<PreparedProductLine, "title" | "allowedDeliveryMethods"> | null,
  method: string,
) {
  if (!line?.allowedDeliveryMethods) return;
  if (!line.allowedDeliveryMethods.includes(method)) {
    throw new ValidationError(
      `${line.title} не відправляємо Новою Поштою: оберіть самовивіз або власну доставку.`,
    );
  }
}

/** Замінює позицію товару в замовленні (або прибирає, якщо `line` порожня). */
export async function saveProductLine(
  tx: AnyPgDatabase,
  orderId: string,
  code: string,
  line: PreparedProductLine | null,
): Promise<void> {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.code, code));
  if (!product) throw new ValidationError("Товар не знайдено.");
  await tx
    .delete(orderItems)
    .where(and(eq(orderItems.orderId, orderId), eq(orderItems.productId, product.id)));
  if (!line) return;
  await tx.insert(orderItems).values({
    orderId,
    kind: "other",
    title: line.title,
    qty: line.qty,
    unit: line.unit,
    price: line.price,
    productId: line.productId,
  });
}

/** Чи є в замовленні позиція цього товару й які способи доставки він дозволяє. */
export async function existingProductLine(
  db: AnyPgDatabase,
  orderId: string,
  code: string,
): Promise<Pick<PreparedProductLine, "title" | "allowedDeliveryMethods"> | null> {
  const [row] = await db
    .select({ title: products.name, allowedDeliveryMethods: products.allowedDeliveryMethods })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orderItems.orderId, orderId), eq(products.code, code)))
    .limit(1);
  return row ?? null;
}

export type WorkshopProduct = { name: string; qty: number; unit: string };

/** Товари замовлень, які виробляє цех і які не лід (рідкий азот): для картки цеху. */
export async function loadWorkshopProducts(
  db: AnyPgDatabase,
  orderIds: string[],
): Promise<Map<string, WorkshopProduct[]>> {
  const result = new Map<string, WorkshopProduct[]>();
  if (orderIds.length === 0) return result;
  const rows = await db
    .select({
      orderId: orderItems.orderId,
      name: products.name,
      qty: orderItems.qty,
      unit: orderItems.unit,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(
      and(
        inArray(orderItems.orderId, orderIds),
        eq(products.producedByWorkshop, true),
        ne(products.kind, "ice"),
      ),
    );
  for (const row of rows) {
    const list = result.get(row.orderId) ?? [];
    list.push({ name: row.name, qty: parseDecimal(row.qty), unit: row.unit });
    result.set(row.orderId, list);
  }
  return result;
}
