import { and, eq } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { orderItems, orderPriceChanges, orders } from "@/db/schema";
import type { OrderStatus } from "@/constants/constants";
import type { AnyPgDatabase } from "@/db/types";
import { parseDecimal } from "@/utils/orderMath";
import { settleCashPayment } from "./cash-settlement";
import { ValidationError } from "./errors";
import { ForbiddenError, type AppUser, requirePermission } from "./guards";
import { checkTransition, isReadyToClose, STATUS_TIMESTAMP_COLUMN } from "./order-rules";
import { loadOrderRow } from "./orders";
import { parsePricePerKg } from "./price-rules";
import { resolvePrice } from "./prices";

/**
 * Переходи статусів і зміна ціни підтвердженого замовлення (D51, D52). Кожен перехід іде в одній
 * транзакції з блокуванням замовлення: двоє не підтвердять його одночасно, ціна не зафіксується
 * двічі. Історію статусів (хто, коли, з якою приміткою) пише тригер бази.
 */

const STALE = "Статус замовлення вже змінився. Оновіть сторінку й повторіть.";

type TransitionOptions = {
  /** Причина скасування, причина кроку назад, примітка до ручного «Оплачено». */
  note?: string;
  /** Для скасування як дубля (D56): перше замовлення, дублем якого воно є. */
  duplicateOf?: string;
};

const NOTE_MESSAGES = {
  cancel: "Вкажіть причину скасування.",
  back: "Вкажіть, чому повертаєте замовлення на крок назад.",
  forward: "Вкажіть примітку: оплату до появи автоматичних платежів ставить власник вручну.",
} as const;

/**
 * Переводить замовлення в новий статус. Правила: `order-rules.ts` (хто, куди, чи потрібна
 * примітка); права за матрицею: «У виробництві» і «Запаковано» через `order_ready_status`, решта
 * через `orders`, обидва з урахуванням локації. Підтвердження фіксує ціну (D52). Повертає новий статус.
 */
export async function transitionOrder(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
  to: OrderStatus,
  options: TransitionOptions = {},
): Promise<{ status: OrderStatus }> {
  const order = await loadOrderRow(db, orderId);
  const check = checkTransition(order.status, to, actor.role);
  if (!check.ok) {
    throw check.code === "forbidden"
      ? new ForbiddenError(check.reason)
      : new ValidationError(check.reason);
  }

  // «У виробництві», «Запаковано» і «Повернути в роботу» (з «Запаковано») це кроки цеху (D73).
  const isProductionStep =
    (check.kind === "forward" && (to === "in_production" || to === "packed")) ||
    (check.kind === "back" && order.status === "packed");
  requirePermission(actor, isProductionStep ? "order_ready_status" : "orders", "write", {
    recordLocationId: order.locationId,
  });

  const note = options.note?.trim() ?? "";
  if (check.needsNote && note === "") throw new ValidationError(NOTE_MESSAGES[check.kind]);

  let settledByCash = false as boolean;
  await withActor(
    db,
    actor.id,
    async (tx) => {
      const [current] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
      if (!current || current.deletedAt || current.status !== order.status) {
        throw new ValidationError(STALE);
      }
      const now = new Date();
      const set: Partial<typeof orders.$inferInsert> = { status: to };

      if (check.kind === "forward") {
        if (to === "confirmed") {
          if (!current.iceTypeId)
            throw new ValidationError("Вкажіть тип льоду, перш ніж підтвердити.");
          if (!(parseDecimal(current.kgSold) > 0)) {
            throw new ValidationError("Вкажіть, скільки кілограмів продано, перш ніж підтвердити.");
          }
          const [iceItem] = await tx
            .select({ price: orderItems.price })
            .from(orderItems)
            .where(and(eq(orderItems.orderId, current.id), eq(orderItems.kind, "ice")))
            .limit(1);
          // Ціну, яку не вказали вручну, беремо за прайсом на дату виконання (D52).
          const resolved = current.priceManual
            ? null
            : await resolvePrice(tx, {
                clientId: current.clientId,
                iceTypeId: current.iceTypeId,
                date: current.orderDate,
              });
          const price = current.priceManual ? (iceItem?.price ?? "0") : resolved?.pricePerKg;
          if (!price || !(parseDecimal(price) > 0)) {
            throw new ValidationError(
              "Немає ціни для цього типу льоду: внесіть її в прайс чи в картку клієнта або вкажіть ціну в замовленні.",
            );
          }
          set.pricePerKgSnapshot = price;
          set.confirmedAt = now;
          set.confirmedBy = actor.id;
          await tx
            .update(orderItems)
            .set({ price })
            .where(and(eq(orderItems.orderId, current.id), eq(orderItems.kind, "ice")));
        } else if (to === "packed") {
          set.packedAt = now;
          set.producedAt = current.producedAt ?? now;
        } else if (to === "shipped") {
          set.shippedAt = now;
        } else if (to === "paid") {
          set.paidAt = now;
        } else if (to === "closed") {
          set.closedAt = now;
        }
      } else if (check.kind === "back") {
        // Залишаємо статус: знімаємо його мітку часу. Назад у чернетку розморожує й ціну (D52).
        const left = current.status as keyof typeof STATUS_TIMESTAMP_COLUMN;
        const column = STATUS_TIMESTAMP_COLUMN[left];
        if (column) set[column] = null;
        if (current.status === "packed") set.producedAt = null;
        if (current.status === "confirmed") {
          set.pricePerKgSnapshot = null;
          set.confirmedBy = null;
        }
      } else {
        set.cancelReason = note;
        if (options.duplicateOf) set.duplicateOf = options.duplicateOf;
      }

      await tx.update(orders).set(set).where(eq(orders.id, current.id));

      // Готівку могли прийняти раніше, ніж замовлення відправили чи запакували (самовивіз):
      // тоді «Оплачено» ставимо одразу після цього кроку (ТЗ 5.1, D67).
      if (check.kind === "forward" && (to === "shipped" || to === "packed")) {
        const [updated] = await tx.select().from(orders).where(eq(orders.id, current.id));
        if (updated && (await settleCashPayment(tx, updated))) settledByCash = true;
      }
    },
    { note: note || undefined },
  );

  // Автозакриття лише після кроку вперед до «Оплачено»: коли власник повертає замовлення з «Закрито»
  // на «Оплачено» (щоб виправити касу, D69), воно не має одразу закритись знову.
  if ((check.kind === "forward" && to === "paid") || settledByCash) {
    await closeIfDone(db, order.id);
  }
  const [latest] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, order.id));
  return { status: latest?.status ?? to };
}

/**
 * Автозакриття (D51): оплачене замовлення без боргу по боксах стає «Закрито». Викликається після
 * «Оплачено»; блоки B9 (повернення боксів) і B13 (оплати) викликатимуть її теж. Виконує система.
 * Повертає, чи замовлення закрито.
 */
export async function closeIfDone(
  db: AnyPgDatabase,
  orderId: string,
  boxDebts = 0,
): Promise<boolean> {
  return withActor(
    db,
    null,
    async (tx) => {
      const [current] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!current || current.deletedAt || !isReadyToClose(current, boxDebts)) return false;
      await tx
        .update(orders)
        .set({ status: "closed", closedAt: new Date() })
        .where(eq(orders.id, current.id));
      return true;
    },
    { note: "Закрито автоматично: замовлення оплачене" },
  );
}

/**
 * Скасовує нове замовлення як дубль іншого (D56). Дубль має бути того самого клієнта. Скасування
 * іде за звичайними правилами (причина, права), у причині записано номер першого замовлення.
 */
export async function cancelAsDuplicate(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
  originalId: string,
): Promise<void> {
  const order = await loadOrderRow(db, orderId);
  const original = await loadOrderRow(db, originalId);
  if (original.id === order.id)
    throw new ValidationError("Замовлення не може бути дублем самого себе.");
  if (original.clientId !== order.clientId) {
    throw new ValidationError("Дубль має бути замовленням того самого клієнта.");
  }
  if (original.status === "cancelled") {
    throw new ValidationError("Те замовлення скасоване: дублем воно бути не може.");
  }
  await transitionOrder(db, actor, order.id, "cancelled", {
    note: `Дубль замовлення №${original.number ?? "?"}`,
    duplicateOf: original.id,
  });
}

export type ChangePriceInput = { pricePerKg: string | number; note: string };

/**
 * Зміна ціни підтвердженого замовлення (D52): лише власник і лише з приміткою. Стара й нова ціна,
 * автор і причина лишаються окремим записом; позиція «Лід» і сума замовлення оновлюються.
 */
export async function changeOrderPrice(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
  input: ChangePriceInput,
): Promise<void> {
  requirePermission(actor, "order_price_override", "write");
  const order = await loadOrderRow(db, orderId);
  if (order.status === "draft") {
    throw new ValidationError("У чернетці ціну міняють у самому замовленні, примітка не потрібна.");
  }
  if (order.status === "closed" || order.status === "cancelled") {
    throw new ValidationError("У закритому чи скасованому замовленні ціну змінити не можна.");
  }
  const note = input.note.trim();
  if (note === "") throw new ValidationError("Вкажіть причину зміни ціни.");
  const newPrice = parsePricePerKg(input.pricePerKg);
  const oldPrice = order.pricePerKgSnapshot;
  if (oldPrice === null) throw new ValidationError("У замовлення ще немає зафіксованої ціни.");
  if (parseDecimal(oldPrice) === parseDecimal(newPrice)) {
    throw new ValidationError("Нова ціна збігається з поточною.");
  }

  await withActor(
    db,
    actor.id,
    async (tx) => {
      const [current] = await tx
        .select({ status: orders.status, price: orders.pricePerKgSnapshot })
        .from(orders)
        .where(eq(orders.id, order.id))
        .for("update");
      if (!current || current.status !== order.status || current.price !== oldPrice) {
        throw new ValidationError("Замовлення вже змінили. Оновіть сторінку й повторіть.");
      }
      await tx.insert(orderPriceChanges).values({
        orderId: order.id,
        oldPrice,
        newPrice,
        note,
        changedBy: actor.id,
      });
      await tx
        .update(orders)
        .set({ pricePerKgSnapshot: newPrice, priceManual: true })
        .where(eq(orders.id, order.id));
      await tx
        .update(orderItems)
        .set({ price: newPrice })
        .where(and(eq(orderItems.orderId, order.id), eq(orderItems.kind, "ice")));
    },
    { note },
  );
}
