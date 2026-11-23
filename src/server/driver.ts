import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { clientAddresses, clients, orders } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { todayIso } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import { loadCashSummary, settleCashPayment } from "./cash-settlement";
import { recordCashEntry, type RecordCashResult } from "./cash";
import { kopecksToUah } from "./cash-rules";
import { ValidationError } from "./errors";
import { ForbiddenError, type AppUser } from "./guards";
import { closeIfDone } from "./order-status";
import { describeDeliveryPlace, describeMapQuery } from "./production-rules";

/**
 * Водій (B12, ТЗ 2.1, 6.13, 8.2, D179–D184). Працює лише через Telegram-бота: бачить доставки дня
 * своєї локації, відмічає «Доставив» і вносить готівку. Окремі функції, а не картка замовлення:
 * водій отримує лише потрібне (клієнт, куди, коли, кг, телефон, скільки взяти готівкою), без цін.
 */

/** Статуси, у яких доставка ще актуальна для водія; «Відправлено» лишається видно того ж дня. */
const DRIVER_STATUSES = ["confirmed", "in_production", "packed", "shipped"] as const;

export type DriverOrder = {
  id: string;
  number: number | null;
  clientName: string;
  status: (typeof DRIVER_STATUSES)[number];
  place: string;
  mapQuery: string | null;
  timeWindow: string | null;
  kg: number;
  recipientName: string | null;
  recipientPhone: string | null;
  comment: string | null;
  /** Скільки взяти готівкою (гривні рядком); `null`, якщо оплата не готівкою чи вже все прийнято. */
  cashDue: string | null;
  /** Кнопка «Доставив» доступна лише для запакованого. */
  canDeliver: boolean;
};

function assertDriver(actor: AppUser): string {
  if (actor.role !== "driver" || !actor.locationId) throw new ForbiddenError();
  return actor.locationId;
}

/** Доставки дня для водія: його локація, спосіб «Власна доставка», дата `date` (за замовчуванням сьогодні). */
export async function listDriverOrders(
  db: AnyPgDatabase,
  actor: AppUser,
  date: string = todayIso(),
): Promise<DriverOrder[]> {
  const locationId = assertDriver(actor);
  const rows = await db
    .select({
      order: orders,
      clientName: clients.name,
      city: clientAddresses.cityText,
      addressText: clientAddresses.addressText,
      warehouse: clientAddresses.npWarehouseNumber,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(clientAddresses, eq(clientAddresses.id, orders.addressId))
    .where(
      and(
        eq(orders.locationId, locationId),
        eq(orders.orderDate, date),
        eq(orders.deliveryMethod, "our_delivery"),
        inArray(orders.status, [...DRIVER_STATUSES]),
        isNull(orders.deletedAt),
      ),
    )
    .orderBy(asc(orders.timeWindow), asc(orders.number));

  const result: DriverOrder[] = [];
  for (const row of rows) {
    const { order } = row;
    const address =
      row.city === null && row.addressText === null && row.warehouse === null
        ? null
        : { cityText: row.city, addressText: row.addressText, npWarehouseNumber: row.warehouse };
    const source = {
      deliveryMethod: order.deliveryMethod,
      deliveryText: order.deliveryText,
      address,
    };
    let cashDue: string | null = null;
    if (order.paymentKind === "cash") {
      const summary = await loadCashSummary(db, order);
      if (!summary.paid && summary.remaining > 0) cashDue = kopecksToUah(summary.remaining);
    }
    result.push({
      id: order.id,
      number: order.number,
      clientName: row.clientName,
      status: order.status as DriverOrder["status"],
      place: describeDeliveryPlace(source),
      mapQuery: describeMapQuery(source),
      timeWindow: order.timeWindow,
      kg: parseDecimal(order.kgSold),
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      comment: order.comment,
      cashDue,
      canDeliver: order.status === "packed",
    });
  }
  return result;
}

async function loadOwnDelivery(db: AnyPgDatabase, actor: AppUser, orderId: string) {
  const locationId = assertDriver(actor);
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.deletedAt) throw new ValidationError("Замовлення не знайдено.");
  if (order.locationId !== locationId) throw new ForbiddenError();
  if (order.deliveryMethod !== "our_delivery") {
    throw new ValidationError("Це не власна доставка.");
  }
  return order;
}

export type DeliveredResult = {
  /** Вже було відмічено раніше: нічого не змінювали. */
  already: boolean;
  /** Чи варто питати про готівку: оплата готівкою і ще не все прийнято. */
  askCash: boolean;
  /** Скільки очікується (гривні рядком), якщо питаємо про готівку. */
  cashDue: string | null;
};

/**
 * «Доставив»: «Запаковано» → «Відправлено» (D181). Повторне натискання нічого не змінює. Готівку,
 * прийняту раніше, враховуємо одразу, як і при ручному кроці.
 */
export async function driverMarkDelivered(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
): Promise<DeliveredResult> {
  const order = await loadOwnDelivery(db, actor, orderId);
  let already = false;
  let settled = false as boolean;
  await withActor(
    db,
    actor.id,
    async (tx) => {
      const [current] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
      if (!current || current.deletedAt) throw new ValidationError("Замовлення не знайдено.");
      if (["shipped", "paid", "closed"].includes(current.status)) {
        already = true;
        return;
      }
      if (current.status !== "packed") {
        throw new ValidationError("Замовлення ще не запаковане: цех його готує.");
      }
      await tx
        .update(orders)
        .set({ status: "shipped", shippedAt: new Date() })
        .where(eq(orders.id, current.id));
      const [updated] = await tx.select().from(orders).where(eq(orders.id, current.id));
      if (updated && (await settleCashPayment(tx, updated))) settled = true;
    },
    { note: "Доставив (бот водія)" },
  );
  if (settled) await closeIfDone(db, order.id);

  const [latest] = await db.select().from(orders).where(eq(orders.id, order.id));
  let cashDue: string | null = null;
  if (latest && latest.paymentKind === "cash" && latest.status === "shipped") {
    const summary = await loadCashSummary(db, latest);
    if (summary.remaining > 0 && !summary.paid) cashDue = kopecksToUah(summary.remaining);
  }
  return { already, askCash: cashDue !== null, cashDue };
}

/** Сума з відповіді водія: «450», «450,50», «450 грн», «450₴». Усе інше відхиляє `recordCashEntry`. */
export function cleanCashText(text: string): string {
  return text
    .replace(/(грн\.?|гривень|гривні|₴|uah)/gi, "")
    .replace(/\s+/g, "")
    .trim();
}

/** Готівка від водія (D182): запис зі способом «бот водія». Помилки вводу повертаємо як `ValidationError`. */
export async function driverRecordCash(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
  text: string,
): Promise<RecordCashResult> {
  const order = await loadOwnDelivery(db, actor, orderId);
  const amount = cleanCashText(text);
  if (amount === "") throw new ValidationError("Напишіть суму цифрами, наприклад 450 або 450,50.");
  return recordCashEntry(db, actor, {
    orderId: order.id,
    amount,
    receivedBy: actor.fullName,
    via: "driver_bot",
  });
}
