import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { products } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";

/**
 * Довідник товарів (D174): лід і бокси завжди є, інші товари (рідкий азот та майбутні) керує власник
 * на екрані «Прайс». Новий товар з'являється в замовленні, прайсі й цеху без змін коду. Права ті
 * самі, що на прайс (D44): міняє власник, решта дивиться.
 */

const DELIVERY_METHODS = ["pickup", "our_delivery", "np"] as const;

export type ProductView = {
  id: string;
  code: string;
  name: string;
  kind: "ice" | "box" | "other";
  unit: string;
  producedByWorkshop: boolean;
  /** `null`: усі способи доставки. */
  allowedDeliveryMethods: string[] | null;
  isActive: boolean;
};

/** Усі товари для екрана «Прайс». */
export async function listProducts(db: AnyPgDatabase, actor: AppUser): Promise<ProductView[]> {
  requirePermission(actor, "default_prices", "read");
  const rows = await db.select().from(products).orderBy(asc(products.sort), asc(products.name));
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind as ProductView["kind"],
    unit: row.unit,
    producedByWorkshop: row.producedByWorkshop,
    allowedDeliveryMethods: row.allowedDeliveryMethods,
    isActive: row.isActive,
  }));
}

const methodsSchema = z
  .array(z.enum(DELIVERY_METHODS, "Невідомий спосіб доставки."))
  .min(1, "Оберіть хоча б один спосіб доставки.");

const baseSchema = z.object({
  name: z.string().trim().min(1, "Вкажіть назву товару.").max(100, "Назва товару надто довга."),
  producedByWorkshop: z.boolean(),
  /** Способи доставки, дозволені для товару; усі три означають «без обмежень». */
  deliveryMethods: methodsSchema,
});

const createSchema = baseSchema.extend({
  unit: z.enum(["кг", "шт"], "Оберіть одиницю: кг чи шт."),
});

const updateSchema = baseSchema.extend({ isActive: z.boolean() });

const normalizeMethods = (methods: readonly string[]): string[] | null =>
  DELIVERY_METHODS.every((method) => methods.includes(method)) ? null : [...methods];

export type CreateProductInput = z.input<typeof createSchema>;
export type UpdateProductInput = z.input<typeof updateSchema>;

/** Додає товар без типів (як рідкий азот). Код створюємо самі: власнику він не потрібен. */
export async function createProduct(
  db: AnyPgDatabase,
  actor: AppUser,
  input: CreateProductInput,
): Promise<{ id: string; code: string }> {
  requirePermission(actor, "default_prices", "write");
  const data = parseInput(createSchema, input);
  const all = await db.select({ sort: products.sort }).from(products);
  const sort = Math.max(0, ...all.map((row) => row.sort)) + 1;
  const code = `product_${Date.now().toString(36)}`;
  return withActor(db, actor.id, async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        code,
        name: data.name,
        kind: "other",
        unit: data.unit,
        producedByWorkshop: data.producedByWorkshop,
        allowedDeliveryMethods: normalizeMethods(data.deliveryMethods),
        sort,
      })
      .returning({ id: products.id, code: products.code });
    return row!;
  });
}

/** Змінює назву, чи виробляє цех, дозволену доставку й активність. Лід і бокси не змінюємо. */
export async function updateProduct(
  db: AnyPgDatabase,
  actor: AppUser,
  productId: string,
  input: UpdateProductInput,
): Promise<void> {
  requirePermission(actor, "default_prices", "write");
  const id = parseInput(z.uuid("Некоректний ідентифікатор."), productId);
  const data = parseInput(updateSchema, input);
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) throw new ValidationError("Товар не знайдено.");
  if (product.kind !== "other") {
    throw new ValidationError("Лід і бокси мають власні довідники: їх тут не міняємо.");
  }
  await withActor(db, actor.id, (tx) =>
    tx
      .update(products)
      .set({
        name: data.name,
        producedByWorkshop: data.producedByWorkshop,
        allowedDeliveryMethods: normalizeMethods(data.deliveryMethods),
        isActive: data.isActive,
      })
      .where(eq(products.id, id)),
  );
}
