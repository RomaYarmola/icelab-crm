import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { boxTypes, clientAddresses, clients, locations, orders, shipments } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/constants/np";
import { isIsoDate } from "@/utils/isoDate";
import { parseInput, ValidationError } from "../errors";
import { type AppUser, locationScope, requirePermission } from "../guards";
import { loadSender } from "./shipments";
import { shipmentBlockers, shipmentParams } from "./shipment-rules";

/**
 * «ТТН на день» (B10, ТЗ 6.8): замовлення Нової Пошти на дату з тим, що заважає створити накладну, і
 * станом уже створених. Виберіть замовлення галочками й створіть їх по одному (D124). Сум тут немає.
 */

export type ShipmentDayRow = {
  orderId: string;
  number: number | null;
  clientId: string;
  clientName: string;
  locationName: string;
  status: string;
  recipient: string;
  addressText: string;
  weightKg: number;
  seats: number;
  /** Що заважає створити ТТН (порожньо, якщо можна). */
  blockers: string[];
  /** Адреса «потребує уточнення»: виділяємо й ведемо на картку клієнта. */
  needsAddress: boolean;
  shipment: {
    id: string;
    status: ShipmentStatus;
    statusLabel: string;
    ttnNumber: string | null;
    errorText: string | null;
  } | null;
  /** Можна вибрати галочкою: накладної ще немає (чи була помилка) і блокерів немає. */
  selectable: boolean;
};

export type ShipmentDay = {
  date: string;
  rows: ShipmentDayRow[];
};

/** Замовлення Нової Пошти на день для старшого локації, менеджера й власника. */
export async function listShipmentDay(
  db: AnyPgDatabase,
  actor: AppUser,
  query: { date: string; locationId?: string | null },
): Promise<ShipmentDay> {
  requirePermission(actor, "shipments", "write", { anyLocation: true });
  const date = parseInput(z.string().refine(isIsoDate, "Вкажіть дату."), query.date);
  const own = locationScope(actor);
  if (actor.role === "location_lead" && !own) return { date, rows: [] };
  const locationId = own ?? query.locationId ?? null;
  if (locationId && !z.string().uuid().safeParse(locationId).success) {
    throw new ValidationError("Некоректна локація.");
  }

  const rows = await db
    .select({
      order: orders,
      clientName: clients.name,
      locationName: locations.name,
      address: clientAddresses,
      shipment: shipments,
      emptyWeightKg: boxTypes.emptyWeightKg,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .innerJoin(locations, eq(locations.id, orders.locationId))
    .leftJoin(clientAddresses, eq(clientAddresses.id, orders.addressId))
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .leftJoin(boxTypes, eq(boxTypes.id, orders.boxTypeId))
    .where(
      and(
        isNull(orders.deletedAt),
        eq(orders.orderDate, date),
        eq(orders.deliveryMethod, "np"),
        inArray(orders.status, [
          "confirmed",
          "in_production",
          "packed",
          "shipped",
          "paid",
          "closed",
        ]),
        locationId ? eq(orders.locationId, locationId) : undefined,
      ),
    )
    .orderBy(asc(clients.name), asc(orders.number));

  const senderReady = new Map<string, boolean>();
  for (const locationIdValue of new Set(rows.map((row) => row.order.locationId))) {
    senderReady.set(locationIdValue, (await loadSender(db, locationIdValue)) !== null);
  }

  return {
    date,
    rows: rows.map(({ order, clientName, locationName, address, shipment, emptyWeightKg }) => {
      const hasTtn = Boolean(shipment?.npRef);
      const blockers = hasTtn
        ? []
        : shipmentBlockers({
            order: {
              status: order.status,
              deliveryMethod: order.deliveryMethod,
              recipientName: order.recipientName,
              recipientPhone: order.recipientPhone,
              kgToProduce: order.kgToProduce,
              boxCount: order.boxCount,
              total: order.total,
            },
            address: address
              ? {
                  kind: address.kind,
                  isResolved: address.isResolved,
                  npCityRef: address.npCityRef,
                  npWarehouseRef: address.npWarehouseRef,
                }
              : null,
            senderReady: senderReady.get(order.locationId) ?? false,
            hasActiveShipment: false,
          });
      const params = shipmentParams({
        kgToProduce: order.kgToProduce,
        boxCount: order.boxCount,
        emptyWeightKg,
      });
      return {
        orderId: order.id,
        number: order.number,
        clientId: order.clientId,
        clientName,
        locationName,
        status: order.status,
        recipient: [order.recipientName, order.recipientPhone].filter(Boolean).join(", "),
        addressText:
          [
            address?.cityText,
            address?.npWarehouseNumber ? `відділення № ${address.npWarehouseNumber}` : null,
            address?.addressText,
          ]
            .filter(Boolean)
            .join(", ") || "Адреса не вказана",
        weightKg: params.weightKg,
        seats: params.seats,
        blockers,
        needsAddress: Boolean(address && !address.isResolved),
        shipment: shipment
          ? {
              id: shipment.id,
              status: shipment.status,
              statusLabel: SHIPMENT_STATUS_LABELS[shipment.status],
              ttnNumber: shipment.ttnNumber,
              errorText: shipment.errorText,
            }
          : null,
        selectable: !hasTtn && blockers.length === 0,
      };
    }),
  };
}
