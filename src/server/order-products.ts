import { and, asc, eq, inArray, ne } from "drizzle-orm";
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

/** Спосіб доставки має бути серед дозволених для кожного товару (рідкий азот: лише самовивіз і власна). */
export function assertDeliveryAllowed(
  lines: Pick<PreparedProductLine, "title" | "allowedDeliveryMethods">[],
  method: string,
) {
  // «Інше» це ще не вибраний спосіб (чернетка з бота): перевіряємо, коли менеджер його обере.
  if (method === "other") return;
  for (const line of lines) {
    if (line.allowedDeliveryMethods && !line.allowedDeliveryMethods.includes(method)) {
      throw new ValidationError(
        `${line.title} не відправляємо Новою Поштою: оберіть самовивіз або власну доставку.`,
      );
    }
  }
}

/** Готує всі позиції товарів без типів; однакові товари зливаємо, кількість додаємо. */
export async function prepareProductLines(
  db: AnyPgDatabase,
  inputs: (ProductLineInput & { code: string })[],
  date: string,
): Promise<PreparedProductLine[]> {
  const merged = new Map<string, PreparedProductLine>();
  for (const input of inputs) {
    const line = await prepareProductLine(db, input.code, input, date);
    const existing = merged.get(line.code);
    if (existing) existing.qty = (Number(existing.qty) + Number(line.qty)).toFixed(3);
    else merged.set(line.code, line);
  }
  return [...merged.values()];
}

/** Замінює позиції товарів без типів у замовленні (лід і бокси на продаж не чіпає). */
export async function saveProductLines(
  tx: AnyPgDatabase,
  orderId: string,
  lines: PreparedProductLine[],
): Promise<void> {
  const others = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.kind, "other"));
  if (others.length > 0) {
    await tx.delete(orderItems).where(
      and(
        eq(orderItems.orderId, orderId),
        inArray(
          orderItems.productId,
          others.map((row) => row.id),
        ),
      ),
    );
  }
  if (lines.length === 0) return;
  await tx.insert(orderItems).values(
    lines.map((line) => ({
      orderId,
      kind: "other" as const,
      title: line.title,
      qty: line.qty,
      unit: line.unit,
      price: line.price,
      productId: line.productId,
    })),
  );
}

/** Позиції товарів без типів, що вже є в замовленні, з їхніми обмеженнями доставки. */
export async function existingProductLines(
  db: AnyPgDatabase,
  orderId: string,
): Promise<Pick<PreparedProductLine, "title" | "allowedDeliveryMethods">[]> {
  return db
    .select({ title: products.name, allowedDeliveryMethods: products.allowedDeliveryMethods })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orderItems.orderId, orderId), eq(products.kind, "other")));
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

export type OrderProductOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  /** Чинна ціна за одиницю (порожня, якщо в прайсі її ще немає). */
  price: string | null;
  allowedDeliveryMethods: string[] | null;
};

/** Активні товари без типів для форми замовлення (рідкий азот та майбутні) з чинними цінами. */
export async function listOrderProducts(
  db: AnyPgDatabase,
  date?: string,
): Promise<OrderProductOption[]> {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.kind, "other"), eq(products.isActive, true)))
    .orderBy(asc(products.sort), asc(products.name));
  const result: OrderProductOption[] = [];
  for (const row of rows) {
    result.push({
      id: row.id,
      code: row.code,
      name: row.name,
      unit: row.unit,
      price: await resolveProductPrice(db, row.code, date),
      allowedDeliveryMethods: row.allowedDeliveryMethods,
    });
  }
  return result;
}

/** Бокси на продаж у замовленнях (D174): вид і кількість, для картки цеху. */
export async function loadBoxSales(
  db: AnyPgDatabase,
  orderIds: string[],
): Promise<Map<string, { name: string; count: number }[]>> {
  const result = new Map<string, { name: string; count: number }[]>();
  if (orderIds.length === 0) return result;
  const rows = await db
    .select({ orderId: orderItems.orderId, title: orderItems.title, qty: orderItems.qty })
    .from(orderItems)
    .where(and(inArray(orderItems.orderId, orderIds), eq(orderItems.kind, "box_sale")));
  for (const row of rows) {
    const list = result.get(row.orderId) ?? [];
    list.push({ name: row.title.replace(/^Бокс\s+/, ""), count: Number(row.qty) });
    result.set(row.orderId, list);
  }
  return result;
}
