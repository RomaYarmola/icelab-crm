import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { orderItems, orders } from "@/db/schema";
import type { OrderStatus } from "@/constants/constants";
import type { AnyPgDatabase } from "@/db/types";
import { isIsoDate } from "@/utils/isoDate";
import { parseInput } from "./errors";
import { type AppUser, requirePermission, requireRole } from "./guards";

/**
 * Дублі замовлень і «як минулого разу» (D56, D57). Обидві функції для тих, хто створює замовлення
 * (власник, менеджер): вони лише підказують, нічого не зберігають.
 */

const uuid = z.uuid("Некоректний ідентифікатор.");
const DUPLICATES_LIMIT = 5;

export type DuplicateOrder = {
  id: string;
  number: number | null;
  status: OrderStatus;
  orderDate: string;
  kgSold: string;
  locationId: string;
};

/**
 * Схожі замовлення (D56): той самий клієнт, та сама дата виконання й той самий тип льоду, не
 * скасовані й не видалені. `excludeId` це саме замовлення, яке перевіряємо (щоб воно не знайшло
 * себе). Збереження не блокуємо: це лише підказка.
 */
export async function findDuplicateOrders(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { clientId: string; orderDate: string; iceTypeId?: string | null; excludeId?: string },
): Promise<DuplicateOrder[]> {
  requirePermission(actor, "orders", "write", { anyLocation: true });
  requireRole(actor, "owner", "manager");
  const clientId = parseInput(uuid, input.clientId);
  const orderDate = parseInput(
    z.string().refine(isIsoDate, "Вкажіть дату замовлення."),
    input.orderDate,
  );
  const iceTypeId = input.iceTypeId ? parseInput(uuid, input.iceTypeId) : null;

  return db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      orderDate: orders.orderDate,
      kgSold: orders.kgSold,
      locationId: orders.locationId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.clientId, clientId),
        eq(orders.orderDate, orderDate),
        iceTypeId ? eq(orders.iceTypeId, iceTypeId) : isNull(orders.iceTypeId),
        ne(orders.status, "cancelled"),
        isNull(orders.deletedAt),
        input.excludeId ? ne(orders.id, parseInput(uuid, input.excludeId)) : undefined,
      ),
    )
    .orderBy(desc(orders.number))
    .limit(DUPLICATES_LIMIT);
}

/** Позиція шаблону «як минулого разу»: без цін, ціни береться за чинним прайсом. */
export type TemplateItem = {
  kind: "delivery" | "box_sale" | "other";
  title: string;
  qty: string;
  unit: string;
  boxTypeId: string | null;
};

export type OrderTemplate = {
  fromOrderId: string;
  fromNumber: number | null;
  locationId: string;
  iceTypeId: string | null;
  kgSold: string;
  sourceId: string | null;
  deliveryMethod: typeof orders.$inferSelect.deliveryMethod;
  addressId: string | null;
  deliveryText: string | null;
  timeWindow: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  boxTypeId: string | null;
  boxCount: number;
  boxOwnership: typeof orders.$inferSelect.boxOwnership;
  paymentKind: typeof orders.$inferSelect.paymentKind;
  /** Додаткові позиції («Доставка», «Продаж боксу», «Інше»): «Лід» створюється з полів замовлення. */
  items: TemplateItem[];
};

/**
 * «Як минулого разу» (D57): дані останнього не скасованого замовлення клієнта для нового замовлення.
 * Дата й ціни не копіюються: дата нова, ціни за чинним прайсом, «виготовити» рахується заново.
 * `null`, якщо в клієнта ще не було замовлень.
 */
export async function repeatLastOrder(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
): Promise<OrderTemplate | null> {
  requirePermission(actor, "orders", "write", { anyLocation: true });
  requireRole(actor, "owner", "manager");
  const id = parseInput(uuid, clientId);

  const [last] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.clientId, id), ne(orders.status, "cancelled"), isNull(orders.deletedAt)))
    .orderBy(desc(orders.orderDate), desc(orders.createdAt))
    .limit(1);
  if (!last) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, last.id))
    .orderBy(orderItems.createdAt);

  return {
    fromOrderId: last.id,
    fromNumber: last.number,
    locationId: last.locationId,
    iceTypeId: last.iceTypeId,
    kgSold: last.kgSold,
    sourceId: last.sourceId,
    deliveryMethod: last.deliveryMethod,
    addressId: last.addressId,
    deliveryText: last.deliveryText,
    timeWindow: last.timeWindow,
    recipientName: last.recipientName,
    recipientPhone: last.recipientPhone,
    boxTypeId: last.boxTypeId,
    boxCount: last.boxCount,
    boxOwnership: last.boxOwnership,
    paymentKind: last.paymentKind,
    items: items
      .filter((item) => item.kind !== "ice")
      .map((item) => ({
        kind: item.kind as TemplateItem["kind"],
        title: item.title,
        qty: item.qty,
        unit: item.unit,
        boxTypeId: item.boxTypeId,
      })),
  };
}
