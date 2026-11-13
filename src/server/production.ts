import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { boxTypes, clientAddresses, clients, iceTypes, locations, orders } from "@/db/schema";
import type { OrderStatus } from "@/constants/constants";
import type { AnyPgDatabase } from "@/db/types";
import { isIsoDate } from "@/utils/isoDate";
import { ValidationError } from "./errors";
import { type AppUser, locationScope, requirePermission } from "./guards";
import { transitionOrder } from "./order-status";
import {
  describeDeliveryPlace,
  isNewForProduction,
  ordersToAutoStart,
  PRODUCTION_STATUSES,
  type ProductionSummary,
  sortProductionQueue,
  summarizeProduction,
} from "./production-rules";

/**
 * Екран виробництва (B6, D63): окремі серверні функції, а не картка замовлення. Цех отримує лише
 * те, що потрібно для роботи: клієнт, скільки виготовити, лід, тара, куди, коли, коментар. Ціни, суми,
 * спосіб оплати, телефони й внутрішній коментар сюди не потрапляють: вибираємо конкретні колонки й
 * збираємо подання вручну (тест перевіряє це для всіх ролей).
 */

/** Примітка в історії, коли відкриття екрана перевело замовлення у виробництво (D72). */
export const AUTO_START_NOTE = "Автоматично: екран виробництва відкрито";

export type ProductionCard = {
  id: string;
  number: number | null;
  locationId: string;
  locationName: string;
  status: Extract<OrderStatus, "confirmed" | "in_production" | "packed">;
  orderDate: string;
  clientCode: string;
  clientName: string;
  iceTypeId: string | null;
  iceTypeName: string | null;
  kgSold: string;
  kgToProduce: string;
  boxTypeName: string | null;
  boxCount: number;
  boxOwnership: "ours" | "client" | "sold";
  deliveryMethod: "pickup" | "our_delivery" | "np" | "bus" | "other";
  /** Куди: «Самовивіз», місто й відділення Нової Пошти чи адреса доставки. */
  deliveryPlace: string;
  timeWindow: string | null;
  comment: string | null;
  /** Цех ще не бачив це замовлення (D65). */
  isNew: boolean;
};

export type ProductionQueue = {
  date: string;
  locationId: string | null;
  cards: ProductionCard[];
  summary: ProductionSummary;
  /** Скільки карток «нових» (лічильник «нових: N»). */
  newCount: number;
};

type QueueScope = { date: string; locationId?: string | null };

function checkDate(date: string): void {
  if (!isIsoDate(date)) throw new ValidationError("Некоректна дата.");
}

/**
 * Локація, за якою читаємо чергу: роль з локацією (старший локації, виробництво) бачить лише свою,
 * власник і менеджер обирають (або бачать усі, якщо не обрано).
 */
function resolveLocation(actor: AppUser, requested: string | null | undefined): string | null {
  return locationScope(actor) ?? requested ?? null;
}

/**
 * Черга виробництва на день: підтверджені, у роботі й запаковані замовлення. Читати можуть власник,
 * менеджер, старший локації й виробництво (матриця: `production_screen`).
 */
export async function listProductionQueue(
  db: AnyPgDatabase,
  actor: AppUser,
  scope: QueueScope,
): Promise<ProductionQueue> {
  requirePermission(actor, "production_screen", "read", { anyLocation: true });
  checkDate(scope.date);
  const locationId = resolveLocation(actor, scope.locationId);

  const conditions = [
    eq(orders.orderDate, scope.date),
    inArray(orders.status, [...PRODUCTION_STATUSES]),
    isNull(orders.deletedAt),
  ];
  if (locationId) conditions.push(eq(orders.locationId, locationId));

  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      locationId: orders.locationId,
      locationName: locations.name,
      status: orders.status,
      orderDate: orders.orderDate,
      clientCode: clients.code,
      clientName: clients.name,
      iceTypeId: orders.iceTypeId,
      iceTypeName: iceTypes.name,
      kgSold: orders.kgSold,
      kgToProduce: orders.kgToProduce,
      boxTypeName: boxTypes.name,
      boxCount: orders.boxCount,
      boxOwnership: orders.boxOwnership,
      deliveryMethod: orders.deliveryMethod,
      deliveryText: orders.deliveryText,
      timeWindow: orders.timeWindow,
      comment: orders.comment,
      seenByProductionAt: orders.seenByProductionAt,
      addressCity: clientAddresses.cityText,
      addressText: clientAddresses.addressText,
      addressWarehouse: clientAddresses.npWarehouseNumber,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .innerJoin(locations, eq(locations.id, orders.locationId))
    .leftJoin(iceTypes, eq(iceTypes.id, orders.iceTypeId))
    .leftJoin(boxTypes, eq(boxTypes.id, orders.boxTypeId))
    .leftJoin(clientAddresses, eq(clientAddresses.id, orders.addressId))
    .where(and(...conditions))
    .orderBy(asc(orders.number));

  const cards: ProductionCard[] = rows.map((row) => ({
    id: row.id,
    number: row.number,
    locationId: row.locationId,
    locationName: row.locationName,
    status: row.status as ProductionCard["status"],
    orderDate: row.orderDate,
    clientCode: row.clientCode,
    clientName: row.clientName,
    iceTypeId: row.iceTypeId,
    iceTypeName: row.iceTypeName,
    kgSold: row.kgSold,
    kgToProduce: row.kgToProduce,
    boxTypeName: row.boxTypeName,
    boxCount: row.boxCount,
    boxOwnership: row.boxOwnership,
    deliveryMethod: row.deliveryMethod,
    deliveryPlace: describeDeliveryPlace({
      deliveryMethod: row.deliveryMethod,
      deliveryText: row.deliveryText,
      address:
        row.addressCity === null && row.addressText === null && row.addressWarehouse === null
          ? null
          : {
              cityText: row.addressCity,
              addressText: row.addressText,
              npWarehouseNumber: row.addressWarehouse,
            },
    }),
    timeWindow: row.timeWindow,
    comment: row.comment,
    isNew: isNewForProduction({ status: row.status, seenByProductionAt: row.seenByProductionAt }),
  }));

  return {
    date: scope.date,
    locationId,
    cards: sortProductionQueue(cards),
    summary: summarizeProduction(cards),
    newCount: cards.filter((card) => card.isNew).length,
  };
}

/**
 * Позначає замовлення побаченими (D65): знімає «Нове». Лише ті, хто працює на екрані (старший
 * локації, виробництво), і лише у своїй локації; власник і менеджер читають, тож «Нове» не знімають.
 * Повертає, скільки замовлень позначено.
 */
export async function markOrdersSeen(
  db: AnyPgDatabase,
  actor: AppUser,
  scope: QueueScope & { orderIds?: string[] },
): Promise<{ marked: number }> {
  requirePermission(actor, "production_screen", "write", { anyLocation: true });
  checkDate(scope.date);
  const locationId = resolveLocation(actor, scope.locationId);

  const conditions = [
    eq(orders.orderDate, scope.date),
    inArray(orders.status, [...PRODUCTION_STATUSES]),
    isNull(orders.deletedAt),
    isNull(orders.seenByProductionAt),
  ];
  if (locationId) conditions.push(eq(orders.locationId, locationId));
  if (scope.orderIds) {
    if (scope.orderIds.length === 0) return { marked: 0 };
    conditions.push(inArray(orders.id, scope.orderIds));
  }

  const marked = await withActor(db, actor.id, (tx) =>
    tx
      .update(orders)
      .set({ seenByProductionAt: new Date() })
      .where(and(...conditions))
      .returning({ id: orders.id }),
  );
  return { marked: marked.length };
}

/**
 * Відкриття екрана виробництва на сьогодні переводить підтверджені замовлення своєї локації у
 * «У виробництві» (ТЗ 5.1, D72). Робить лише цех чи старший локації; власник і менеджер нічого не
 * запускають. Кожен перехід іде за звичайними правилами й пише історію з примітками. Повертає, скільки
 * замовлень запущено.
 */
export async function autoStartProduction(
  db: AnyPgDatabase,
  actor: AppUser,
  today: string,
): Promise<{ started: number }> {
  requirePermission(actor, "production_screen", "write", { anyLocation: true });
  checkDate(today);
  const locationId = locationScope(actor);
  if (!locationId) return { started: 0 };

  const candidates = await db
    .select({ id: orders.id, status: orders.status, orderDate: orders.orderDate })
    .from(orders)
    .where(
      and(
        eq(orders.locationId, locationId),
        eq(orders.orderDate, today),
        eq(orders.status, "confirmed"),
        isNull(orders.deletedAt),
      ),
    )
    .orderBy(asc(orders.number));

  let started = 0;
  for (const order of ordersToAutoStart(candidates, today, actor.role)) {
    try {
      await transitionOrder(db, actor, order.id, "in_production", { note: AUTO_START_NOTE });
      started += 1;
    } catch (error) {
      // Хтось встиг раніше (статус уже змінився): це не помилка, пропускаємо.
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  return { started };
}
