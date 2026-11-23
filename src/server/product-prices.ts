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
    .select({ id: boxTypes.id, isClientOwned: boxTypes.isClientOwned })
    .from(boxTypes)
    .where(eq(boxTypes.id, boxTypeId));
  if (!type) throw new ValidationError("Тип бокса не знайдено.");
  if (type.isClientOwned) throw new ValidationError("Бокси клієнтів ми не продаємо.");
  const productId = await productIdByCode(db, "box");

  return withActor(db, actor.id, async (tx) => {
    const [open] = await tx
      .select()
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, productId),
          eq(productPrices.boxTypeId, boxTypeId),
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
