import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { boxTypes, productPrices, products } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { todayIso } from "@/utils/isoDate";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";
import { parsePriceDate, parsePricePerKg, planPriceChange } from "./price-rules";

/**
 * Ціни товарів з історією «нова ціна від дати» (D45, D175): бокси по типах, рідкий азот і майбутні
 * товари. Лід має власний прайс (`default_prices`). Права ті самі, що на прайс льоду (D44).
 */

const uuid = z.uuid("Некоректний ідентифікатор.");

/** Товар за кодом. */
export async function productIdByCode(db: AnyPgDatabase, code: string): Promise<string> {
  const [row] = await db.select({ id: products.id }).from(products).where(eq(products.code, code));
  if (!row) throw new ValidationError("Товар не знайдено.");
  return row.id;
}

/** Ціна боксів, що діє на дату: `null`, якщо ціни ще немає. Без перевірки прав (для серверного коду). */
export async function resolveBoxPrice(
  db: AnyPgDatabase,
  boxTypeId: string,
  date: string = todayIso(),
): Promise<string | null> {
  const [row] = await db
    .select({ price: productPrices.pricePerUnit })
    .from(productPrices)
    .innerJoin(products, eq(products.id, productPrices.productId))
    .where(
      and(
        eq(products.code, "box"),
        eq(productPrices.boxTypeId, boxTypeId),
        sql`${productPrices.validFrom} <= ${date} and (${productPrices.validTo} is null or ${productPrices.validTo} >= ${date})`,
      ),
    )
    .orderBy(desc(productPrices.validFrom))
    .limit(1);
  return row?.price ?? null;
}

/** Ціни боксів на дату для форм (тип бокса → ціна). */
export async function currentBoxPrices(
  db: AnyPgDatabase,
  date: string = todayIso(),
): Promise<Record<string, string>> {
  const rows = await db
    .select({ boxTypeId: productPrices.boxTypeId, price: productPrices.pricePerUnit })
    .from(productPrices)
    .innerJoin(products, eq(products.id, productPrices.productId))
    .where(
      and(
        eq(products.code, "box"),
        sql`${productPrices.boxTypeId} is not null`,
        sql`${productPrices.validFrom} <= ${date} and (${productPrices.validTo} is null or ${productPrices.validTo} >= ${date})`,
      ),
    )
    .orderBy(asc(productPrices.validFrom));
  const result: Record<string, string> = {};
  for (const row of rows) if (row.boxTypeId) result[row.boxTypeId] = row.price;
  return result;
}

export type BoxPriceChangeInput = {
  boxTypeId: string;
  pricePerUnit: string | number;
  /** Дата YYYY-MM-DD, з якої діє ціна (можна майбутню). */
  validFrom: string;
};

/** Запис ціни товару за правилами історії (D45); `boxTypeId` порожній для товарів без типів. */
async function writePrice(
  db: AnyPgDatabase,
  actorId: string,
  input: { productId: string; boxTypeId: string | null; price: string; validFrom: string },
): Promise<{ id: string }> {
  const { productId, boxTypeId, price, validFrom } = input;
  return withActor(db, actorId, async (tx) => {
    const [open] = await tx
      .select()
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, productId),
          boxTypeId ? eq(productPrices.boxTypeId, boxTypeId) : isNull(productPrices.boxTypeId),
          isNull(productPrices.validTo),
        ),
      )
      .for("update");
    const plan = planPriceChange({
      open: open ? { id: open.id, pricePerKg: open.pricePerUnit, validFrom: open.validFrom } : null,
      pricePerKg: price,
      validFrom,
    });
    if (plan.kind === "correct") {
      const [row] = await tx
        .update(productPrices)
        .set({ pricePerUnit: price })
        .where(eq(productPrices.id, plan.id))
        .returning({ id: productPrices.id });
      return row!;
    }
    if (plan.kind === "replace") {
      await tx
        .update(productPrices)
        .set({ validTo: plan.closeTo })
        .where(eq(productPrices.id, plan.closeId));
    }
    const [row] = await tx
      .insert(productPrices)
      .values({ productId, boxTypeId, pricePerUnit: price, validFrom: plan.validFrom })
      .returning({ id: productPrices.id });
    return row!;
  });
}

/** Ціна бокса «нова ціна від дати». Лише власник (як прайс). */
export async function changeBoxPrice(
  db: AnyPgDatabase,
  actor: AppUser,
  input: BoxPriceChangeInput,
): Promise<{ id: string }> {
  requirePermission(actor, "default_prices", "write");
  const boxTypeId = parseInput(uuid, input.boxTypeId);
  const price = parsePricePerKg(input.pricePerUnit);
  const validFrom = parsePriceDate(input.validFrom);
  const [type] = await db
    .select({ id: boxTypes.id, isClientOwned: boxTypes.isClientOwned, kind: boxTypes.kind })
    .from(boxTypes)
    .where(eq(boxTypes.id, boxTypeId));
  if (!type) throw new ValidationError("Тип бокса не знайдено.");
  if (type.isClientOwned) throw new ValidationError("Бокси клієнтів ми не продаємо.");
  if (type.kind === "dewar") throw new ValidationError("Сосуди Дюара ми не продаємо.");
  const productId = await productIdByCode(db, "box");
  return writePrice(db, actor.id, { productId, boxTypeId, price, validFrom });
}

/** Ціна товару без типів (рідкий азот) за одиницю на дату; `null`, якщо її немає. Без перевірки прав. */
export async function resolveProductPrice(
  db: AnyPgDatabase,
  productCode: string,
  date: string = todayIso(),
): Promise<string | null> {
  const [row] = await db
    .select({ price: productPrices.pricePerUnit })
    .from(productPrices)
    .innerJoin(products, eq(products.id, productPrices.productId))
    .where(
      and(
        eq(products.code, productCode),
        isNull(productPrices.boxTypeId),
        sql`${productPrices.validFrom} <= ${date} and (${productPrices.validTo} is null or ${productPrices.validTo} >= ${date})`,
      ),
    )
    .orderBy(desc(productPrices.validFrom))
    .limit(1);
  return row?.price ?? null;
}

/** Ціна товару без типів «нова ціна від дати» (рідкий азот). Лише власник. */
export async function changeProductPrice(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { productCode: string; pricePerUnit: string | number; validFrom: string },
): Promise<{ id: string }> {
  requirePermission(actor, "default_prices", "write");
  const price = parsePricePerKg(input.pricePerUnit);
  const validFrom = parsePriceDate(input.validFrom);
  if (input.productCode === "ice" || input.productCode === "box") {
    throw new ValidationError("Ціни льоду й боксів міняють у своїх блоках прайсу.");
  }
  const productId = await productIdByCode(db, input.productCode);
  return writePrice(db, actor.id, { productId, boxTypeId: null, price, validFrom });
}

export type ProductPriceHistoryItem = {
  id: string;
  pricePerUnit: string;
  validFrom: string;
  validTo: string | null;
};

/** Історія цін товару без типів (рідкий азот) для екрана «Прайс». */
export async function listProductPrices(
  db: AnyPgDatabase,
  actor: AppUser,
  productCode: string,
): Promise<ProductPriceHistoryItem[]> {
  requirePermission(actor, "default_prices", "read");
  return db
    .select({
      id: productPrices.id,
      pricePerUnit: productPrices.pricePerUnit,
      validFrom: productPrices.validFrom,
      validTo: productPrices.validTo,
    })
    .from(productPrices)
    .innerJoin(products, eq(products.id, productPrices.productId))
    .where(and(eq(products.code, productCode), isNull(productPrices.boxTypeId)))
    .orderBy(desc(productPrices.validFrom));
}

export type BoxPriceHistoryItem = {
  id: string;
  boxTypeId: string;
  boxTypeName: string;
  pricePerUnit: string;
  validFrom: string;
  validTo: string | null;
};

/** Уся історія цін боксів для екрана «Прайс». */
export async function listBoxPrices(
  db: AnyPgDatabase,
  actor: AppUser,
): Promise<BoxPriceHistoryItem[]> {
  requirePermission(actor, "default_prices", "read");
  const rows = await db
    .select({
      id: productPrices.id,
      boxTypeId: productPrices.boxTypeId,
      boxTypeName: boxTypes.name,
      pricePerUnit: productPrices.pricePerUnit,
      validFrom: productPrices.validFrom,
      validTo: productPrices.validTo,
    })
    .from(productPrices)
    .innerJoin(products, eq(products.id, productPrices.productId))
    .innerJoin(boxTypes, eq(boxTypes.id, productPrices.boxTypeId))
    .where(eq(products.code, "box"))
    .orderBy(asc(boxTypes.sort), desc(productPrices.validFrom));
  return rows.map((row) => ({ ...row, boxTypeId: row.boxTypeId! }));
}
