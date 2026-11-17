import { z } from "zod";

/**
 * Схема відповіді розбору заявки (ТЗ 8.3, B11). Claude повертає її через інструмент `record_order`;
 * після цього ми ще раз перевіряємо відповідь тут, бо модель не вигадує поле, але може помилитись.
 */

export const ICE_CODES = ["3mm", "16mm", "19mm"] as const;
export const BOX_OWNERSHIPS = ["ours", "client", "sold"] as const;
export const DELIVERY_METHODS = ["pickup", "our_delivery", "np", "bus", "other"] as const;
export const PAYMENT_HINTS = ["cash", "fop", "company"] as const;

const text = z.string().trim().max(500).nullable();

export const parseResultSchema = z.object({
  client: z.object({
    /** Код клієнта зі списку (`АА21`); `null`, якщо клієнта не визначено. */
    code: z.string().trim().max(20).nullable(),
    name_guess: text,
    confidence: z.number().min(0).max(1),
  }),
  order_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  kg_sold: z.number().min(0).max(100_000).nullable(),
  ice_type: z.enum(ICE_CODES).nullable(),
  box: z.object({
    type_code: z.string().trim().max(60).nullable(),
    count: z.number().int().min(0).max(10_000).nullable(),
    ownership: z.enum(BOX_OWNERSHIPS).nullable(),
  }),
  delivery: z.object({
    method: z.enum(DELIVERY_METHODS).nullable(),
    city: text,
    np_warehouse_number: z.string().trim().max(20).nullable(),
    address: text,
    time_window: z.string().trim().max(50).nullable(),
    recipient_name: z.string().trim().max(100).nullable(),
    recipient_phone: z.string().trim().max(30).nullable(),
  }),
  payment_hint: z.enum(PAYMENT_HINTS).nullable(),
  comment: z.string().trim().max(2000).nullable(),
  /** Що неясно: кожен пункт короткою фразою українською. */
  unclear: z.array(z.string().trim().max(200)).max(20),
});

export type ParseResult = z.infer<typeof parseResultSchema>;

/** JSON-схема інструмента для Claude (та сама форма, без службового ключа `$schema`). */
export function toolInputSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(parseResultSchema) as Record<
    string,
    unknown
  >;
  void _ignored;
  return schema;
}
