import { z } from "zod";
import { parseDecimal } from "@/utils/orderMath";

/**
 * Схеми введення позицій замовлення (D55), спільні для `order-items.ts` і `orders.ts` (позиції
 * при створенні замовлення). Окремий файл без звернень до бази, щоб модулі не залежали один
 * від одного по колу.
 */

const uuid = z.uuid("Некоректний ідентифікатор.");
const MAX_AMOUNT_FIELD = 1_000_000;

const numberField = (message: string) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => parseDecimal(value))
    .pipe(
      z
        .number(message)
        .min(0, "Значення не може бути від'ємним.")
        .max(MAX_AMOUNT_FIELD, "Надто велике значення: перевірте число."),
    );

export const itemFields = {
  kind: z.enum(
    ["delivery", "box_sale", "other"],
    "Оберіть вид позиції: доставка, продаж боксу чи інше.",
  ),
  title: z.string().trim().min(1, "Вкажіть назву позиції.").max(200, "Назва позиції надто довга."),
  qty: numberField("Кількість має бути числом.").refine(
    (value) => value > 0,
    "Кількість має бути більшою за нуль.",
  ),
  unit: z.string().trim().min(1, "Вкажіть одиницю виміру.").max(20, "Одиниця виміру надто довга."),
  price: numberField("Ціна має бути числом."),
  boxTypeId: uuid.nullable().optional(),
};

export const addItemSchema = z.object({ ...itemFields, unit: itemFields.unit.optional() });
export const updateItemSchema = z.object(itemFields).omit({ kind: true }).partial();

/** Позиція при створенні замовлення: ціна не обов'язкова («як минулого разу» копіює позиції без цін, тоді 0). */
export const newItemSchema = z.object({
  ...itemFields,
  unit: itemFields.unit.optional(),
  price: itemFields.price.optional(),
});

export type OrderItemInput = z.input<typeof addItemSchema>;
export type OrderItemPatch = z.input<typeof updateItemSchema>;
export type NewOrderItemInput = z.input<typeof newItemSchema>;

export const DEFAULT_UNIT = { delivery: "послуга", box_sale: "шт", other: "шт" } as const;
