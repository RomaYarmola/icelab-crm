import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  boxes,
  boxTypes,
  clients,
  locations,
  orderBoxes,
  orders,
  shipmentReturns,
  shipments,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { todayIso } from "@/utils/isoDate";
import { daysAtClient } from "../boxes";
import { type AppUser, locationScope, requirePermission } from "../guards";

/**
 * «Бокси → Чекають на пошті» (B17, D224, D225): повернення, які ще не забрали. Бачать ті самі, кому
 * доступні борги й склад, виробництво теж: тут немає ні цін, ні сум. Ролі з локацією лише своє місто.
 */

export type PostReturnState = "waiting" | "transit" | "registered";

export type PostReturn = {
  id: string;
  locationId: string;
  clientId: string;
  clientName: string;
  orderNumber: number;
  /** Коди боксів з наклейками, виданих за цим замовленням і ще «У клієнта». */
  boxCodes: string[];
  /** Тара: типи виданих боксів, а без наклейок наша тара з замовлення. */
  boxSummary: string | null;
  ttnNumber: string;
  state: PostReturnState;
  /** Статус словами Нової Пошти. */
  statusText: string | null;
  city: string | null;
  warehouseName: string | null;
  warehouseNumber: string | null;
  /** Скільки календарних днів посилка чекає на відділенні; `null`, доки не прибула. */
  waitingDays: number | null;
  /** День початку платного зберігання `YYYY-MM-DD` за Києвом. */
  paidStorageDay: string | null;
  /** Платне зберігання вже йде або почнеться завтра. */
  urgent: boolean;
};

export type PostReturnGroup = { locationId: string; locationName: string; items: PostReturn[] };

const STATE_ORDER: Record<PostReturnState, number> = { waiting: 0, transit: 1, registered: 2 };

/** Спершу ті, що чекають (найближче платне зберігання, потім найдовше), далі в дорозі. */
export function compareReturns(a: PostReturn, b: PostReturn): number {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    (a.paidStorageDay ?? "9999").localeCompare(b.paidStorageDay ?? "9999") ||
    (b.waitingDays ?? 0) - (a.waitingDays ?? 0) ||
    a.clientName.localeCompare(b.clientName, "uk")
  );
}

/** «Довгий 46 л × 2, Міні 9 л»: назви з кількістю. */
function summarize(entries: readonly { name: string; count: number }[]): string | null {
  const totals = new Map<string, number>();
  for (const { name, count } of entries) totals.set(name, (totals.get(name) ?? 0) + count);
  const parts = [...totals].map(([name, count]) => (count > 1 ? `${name} × ${count}` : name));
  return parts.join(", ") || null;
}

export async function listPostReturns(
  db: AnyPgDatabase,
  actor: AppUser,
  options: { locationId?: string; now?: Date } = {},
): Promise<PostReturnGroup[]> {
  requirePermission(actor, "box_debts_stock", "read", { anyLocation: true });
  const now = options.now ?? new Date();
  const scope = locationScope(actor) ?? options.locationId ?? null;

  const rows = await db
    .select({
      row: shipmentReturns,
      orderId: orders.id,
      orderNumber: orders.number,
      clientId: clients.id,
      clientName: clients.name,
    })
    .from(shipmentReturns)
    .innerJoin(shipments, eq(shipments.id, shipmentReturns.shipmentId))
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(
      and(
        isNotNull(shipmentReturns.ttnNumber),
        isNull(shipmentReturns.closedAt),
        scope ? eq(shipmentReturns.locationId, scope) : undefined,
      ),
    );
  if (rows.length === 0) return [];

  const orderIds = rows.map((r) => r.orderId);
  const [issued, lines, places] = await Promise.all([
    db
      .select({ orderId: boxes.currentOrderId, code: boxes.code, name: boxTypes.name })
      .from(boxes)
      .innerJoin(boxTypes, eq(boxTypes.id, boxes.boxTypeId))
      .where(and(eq(boxes.status, "at_client"), inArray(boxes.currentOrderId, orderIds)))
      .orderBy(boxes.code),
    db
      .select({ orderId: orderBoxes.orderId, count: orderBoxes.count, name: boxTypes.name })
      .from(orderBoxes)
      .innerJoin(boxTypes, eq(boxTypes.id, orderBoxes.boxTypeId))
      .where(inArray(orderBoxes.orderId, orderIds))
      .orderBy(orderBoxes.sort),
    db.select({ id: locations.id, name: locations.name }).from(locations).orderBy(locations.name),
  ]);

  const tomorrow = todayIso(new Date(now.getTime() + 86_400_000));
  const items = rows.map(({ row, orderId, orderNumber, clientId, clientName }): PostReturn => {
    const own = issued.filter((box) => box.orderId === orderId);
    const summary = own.length
      ? summarize(own.map((box) => ({ name: box.name, count: 1 })))
      : summarize(lines.filter((line) => line.orderId === orderId));
    const state: PostReturnState =
      row.status === "arrived"
        ? "waiting"
        : row.status === null || row.status === "created"
          ? "registered"
          : "transit";
    const paidStorageDay = row.paidStorageFrom ? todayIso(row.paidStorageFrom) : null;
    return {
      id: row.id,
      locationId: row.locationId!,
      clientId,
      clientName,
      orderNumber,
      boxCodes: own.map((box) => box.code),
      boxSummary: summary,
      ttnNumber: row.ttnNumber!,
      state,
      statusText: row.statusText,
      city: row.city,
      warehouseName: row.warehouseName,
      warehouseNumber: row.warehouseNumber,
      waitingDays: state === "waiting" && row.arrivedAt ? daysAtClient(row.arrivedAt, now) : null,
      paidStorageDay,
      urgent: state === "waiting" && paidStorageDay !== null && paidStorageDay <= tomorrow,
    };
  });

  return places
    .map((place) => ({
      locationId: place.id,
      locationName: place.name,
      items: items.filter((item) => item.locationId === place.id).sort(compareReturns),
    }))
    .filter((group) => group.items.length > 0);
}
