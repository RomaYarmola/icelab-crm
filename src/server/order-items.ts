import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { boxTypes, orderItems, orders } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseInput, ValidationError } from "./errors";
import { ForbiddenError, type AppUser, requirePermission } from "./guards";
import {
  addItemSchema,
  DEFAULT_UNIT,
  type OrderItemInput,
  type OrderItemPatch,
  updateItemSchema,
} from "./order-item-schema";
import { editPolicy } from "./order-rules";
import { loadOrderRow } from "./orders";

/**
 * Позиції замовлення (D55): «Доставка», «Продаж боксу» та «Інше» з назвою, кількістю й ціною. Позиція
 * «Лід» одна, її кількість і ціну задають поля замовлення, тому через ці функції її не міняють.
 * Сума замовлення перераховується базою. Права: ті самі, що на основні поля замовлення (D58).
 */

const uuid = z.uuid("Некоректний ідентифікатор.");

export type { OrderItemInput, OrderItemPatch };

/** Чи можна міняти позиції замовлення в цьому статусі цією роллю (D58); повертає, чи потрібна примітка. */
function assertCanEditItems(
  order: Awaited<ReturnType<typeof loadOrderRow>>,
  actor: AppUser,
  note?: string,
) {
  requirePermission(actor, "orders", "write", { recordLocationId: order.locationId });
  const { core } = editPolicy(order.status, actor.role);
  if (core === "none") throw new ForbiddenError("Позиції цього замовлення вже не можна змінювати.");
  if (core === "owner_note" && !note?.trim()) {
    throw new ValidationError("Замовлення вже у виробництві: вкажіть причину зміни.");
  }
}

async function assertBoxType(db: AnyPgDatabase, boxTypeId: string | null | undefined) {
  if (!boxTypeId) return;
  const [row] = await db
    .select({ id: boxTypes.id })
    .from(boxTypes)
    .where(eq(boxTypes.id, boxTypeId))
    .limit(1);
  if (!row) throw new ValidationError("Тип тари не знайдено.");
}

/** Додає позицію («Доставка», «Продаж боксу», «Інше»). Повертає її ідентифікатор. */
export async function addOrderItem(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
  input: OrderItemInput,
  options: { note?: string } = {},
): Promise<{ id: string }> {
  const order = await loadOrderRow(db, orderId);
  assertCanEditItems(order, actor, options.note);
  const data = parseInput(addItemSchema, input);
  await assertBoxType(db, data.boxTypeId);

  return withActor(
    db,
    actor.id,
    async (tx) => {
      const [current] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, order.id))
        .for("update");
      if (!current || current.status !== order.status) {
        throw new ValidationError("Замовлення вже змінили. Оновіть сторінку й повторіть.");
      }
      const [item] = await tx
        .insert(orderItems)
        .values({
          orderId: order.id,
          kind: data.kind,
          title: data.title,
          qty: String(data.qty),
          unit: data.unit ?? DEFAULT_UNIT[data.kind],
          price: String(data.price),
          boxTypeId: data.boxTypeId ?? null,
        })
        .returning({ id: orderItems.id });
      return item!;
    },
    { note: options.note },
  );
}

async function loadItem(db: AnyPgDatabase, itemId: string) {
  const id = parseInput(uuid, itemId);
  const [item] = await db.select().from(orderItems).where(eq(orderItems.id, id)).limit(1);
  if (!item) throw new ValidationError("Позицію не знайдено.");
  if (item.kind === "ice") {
    throw new ValidationError("Позицію «Лід» змінюють через поля замовлення: тип льоду, кг, ціна.");
  }
  return item;
}

/** Змінює назву, кількість, одиницю, ціну чи тару позиції (не «Лід»). */
export async function updateOrderItem(
  db: AnyPgDatabase,
  actor: AppUser,
  itemId: string,
  patch: OrderItemPatch,
  options: { note?: string } = {},
): Promise<void> {
  const item = await loadItem(db, itemId);
  const order = await loadOrderRow(db, item.orderId);
  assertCanEditItems(order, actor, options.note);
  const data = parseInput(updateItemSchema, patch);
  await assertBoxType(db, data.boxTypeId);

  const set: Partial<typeof orderItems.$inferInsert> = {};
  if (data.title !== undefined) set.title = data.title;
  if (data.qty !== undefined) set.qty = String(data.qty);
  if (data.unit !== undefined) set.unit = data.unit;
  if (data.price !== undefined) set.price = String(data.price);
  if (data.boxTypeId !== undefined) set.boxTypeId = data.boxTypeId;
  if (Object.keys(set).length === 0) return;

  await withActor(
    db,
    actor.id,
    async (tx) => {
      const [current] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, order.id))
        .for("update");
      if (!current || current.status !== order.status) {
        throw new ValidationError("Замовлення вже змінили. Оновіть сторінку й повторіть.");
      }
      await tx
        .update(orderItems)
        .set(set)
        .where(and(eq(orderItems.id, item.id), eq(orderItems.orderId, order.id)));
    },
    { note: options.note },
  );
}

/** Видаляє позицію (не «Лід»). */
export async function deleteOrderItem(
  db: AnyPgDatabase,
  actor: AppUser,
  itemId: string,
  options: { note?: string } = {},
): Promise<void> {
  const item = await loadItem(db, itemId);
  const order = await loadOrderRow(db, item.orderId);
  assertCanEditItems(order, actor, options.note);

  await withActor(
    db,
    actor.id,
    async (tx) => {
      const [current] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, order.id))
        .for("update");
      if (!current || current.status !== order.status) {
        throw new ValidationError("Замовлення вже змінили. Оновіть сторінку й повторіть.");
      }
      await tx.delete(orderItems).where(eq(orderItems.id, item.id));
    },
    { note: options.note },
  );
}
