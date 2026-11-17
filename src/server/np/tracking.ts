import { and, asc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { npSyncState, orders, shipments } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import type { ShipmentStatus } from "@/constants/np";
import { type AppUser, requirePermission } from "../guards";
import { ValidationError } from "../errors";
import { markShippedBySystem } from "../order-status";
import { callNp } from "./client";

/**
 * Трекінг накладних Нової Пошти (B10, D129, ТЗ 5.4 і 8.4): раз на 15 хвилин питаємо статуси всіх
 * незавершених ТТН (до 100 номерів за запит, не старші 30 днів), записуємо зміну статусу й, коли
 * посилку відправлено, переводимо замовлення «Запаковано» у «Відправлено». Без зміни нічого не
 * пишемо: журнал змін не засмічуємо. «Отримано» статус замовлення більше не міняє (оплата окремо).
 */

export const TRACKING_BATCH = 100;
const MAX_AGE_DAYS = 30;
const TRACKING_KEY = "tracking";
/** Статуси, за якими ТТН ще відстежуємо. */
export const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = [
  "created",
  "sent",
  "arrived",
  "returning",
];

/**
 * Коди статусів Нової Пошти (`TrackingDocument/getStatusDocuments`) у наші статуси. Невідомий код
 * не міняє статус, лише текст.
 */
const STATUS_BY_CODE: Record<string, ShipmentStatus> = {
  "1": "created", // очікує надходження від відправника
  "12": "created", // комплектує відправлення
  "4": "sent",
  "41": "sent",
  "5": "sent",
  "6": "sent",
  "101": "sent",
  "104": "sent",
  "111": "sent",
  "112": "sent",
  "7": "arrived",
  "8": "arrived",
  "9": "received",
  "10": "received",
  "11": "received",
  "102": "refused",
  "103": "refused",
  "105": "returning",
  "106": "returned",
};

/** Код статусу Нової Пошти в наш статус накладної; `null` для невідомих і службових кодів. */
export function mapNpStatus(code: string): ShipmentStatus | null {
  return STATUS_BY_CODE[code] ?? null;
}

/** Статуси, за яких посилка вже в дорозі чи в одержувача: замовлення стає «Відправлено». */
const SHIPPED_STATUSES: ShipmentStatus[] = ["sent", "arrived", "received"];

type RawTracking = { Number?: string; StatusCode?: string | number; Status?: string };

export type TrackingResult = {
  checked: number;
  changed: number;
  shipped: number;
  /** Накладні, що повертаються чи з відмовою одержувача: на них варто звернути увагу. */
  attention: { ttn: string; status: ShipmentStatus; text: string | null }[];
  message: string;
};

type Options = {
  now?: Date;
  /** Лише ці накладні (оновлення однієї з картки замовлення). */
  shipmentIds?: string[];
  api?: Parameters<typeof callNp>[2];
};

/**
 * Опитує Нову Пошту й записує зміни. Помилка Нової Пошти (мережа, ключ) кидається далі: розклад
 * просто повторить за 15 хвилин, стан накладних не псується.
 */
export async function trackShipments(
  db: AnyPgDatabase,
  options: Options = {},
): Promise<TrackingResult> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000);
  const candidates = await db
    .select()
    .from(shipments)
    .where(
      and(
        isNotNull(shipments.ttnNumber),
        inArray(shipments.status, ACTIVE_SHIPMENT_STATUSES),
        gte(shipments.createdInNpAt, since),
        options.shipmentIds ? inArray(shipments.id, options.shipmentIds) : undefined,
      ),
    )
    .orderBy(asc(shipments.createdInNpAt));

  const result: TrackingResult = { checked: 0, changed: 0, shipped: 0, attention: [], message: "" };
  for (let start = 0; start < candidates.length; start += TRACKING_BATCH) {
    const batch = candidates.slice(start, start + TRACKING_BATCH);
    const response = await callNp<RawTracking>(
      db,
      {
        modelName: "TrackingDocument",
        calledMethod: "getStatusDocuments",
        methodProperties: {
          Documents: batch.map((row) => ({ DocumentNumber: row.ttnNumber!, Phone: "" })),
        },
      },
      options.api,
    );
    const byNumber = new Map(response.data.map((row) => [String(row.Number), row]));

    for (const row of batch) {
      result.checked += 1;
      const found = byNumber.get(row.ttnNumber!);
      if (!found) continue;
      const code = String(found.StatusCode ?? "");
      const text = found.Status?.trim() || null;

      // Накладну видалили в кабінеті: звільняємо замовлення для нової ТТН.
      if (code === "2") {
        await withActor(db, null, (tx) =>
          tx
            .update(shipments)
            .set({
              status: "error",
              errorText: "Накладну видалено в кабінеті Нової Пошти. Створіть її знову.",
              npRef: null,
              ttnNumber: null,
              statusCode: code,
              statusText: text,
            })
            .where(eq(shipments.id, row.id)),
        );
        result.changed += 1;
        continue;
      }

      const mapped = mapNpStatus(code);
      const status = mapped ?? row.status;
      if (status === row.status && code === row.statusCode && text === row.statusText) continue;

      await withActor(db, null, (tx) =>
        tx
          .update(shipments)
          .set({ status, statusCode: code, statusText: text, lastTrackedAt: now })
          .where(eq(shipments.id, row.id)),
      );
      result.changed += 1;

      if (SHIPPED_STATUSES.includes(status)) {
        const changedOrder = await markShippedBySystem(
          db,
          row.orderId,
          `Нова Пошта: ТТН ${row.ttnNumber}${text ? `, ${text}` : ""}`,
        );
        if (changedOrder) result.shipped += 1;
      }
      if (status === "refused" || status === "returning" || status === "returned") {
        result.attention.push({ ttn: row.ttnNumber!, status, text });
      }
    }
  }

  if (!options.shipmentIds) {
    await db
      .insert(npSyncState)
      .values({
        key: TRACKING_KEY,
        phase: "idle",
        lastFinishedAt: now,
        citiesCount: result.checked,
      })
      .onConflictDoUpdate({
        target: npSyncState.key,
        set: { lastFinishedAt: now, citiesCount: result.checked, updatedAt: now },
      });
  }
  result.message =
    result.checked === 0
      ? "Незавершених накладних немає."
      : `Перевірено ${result.checked}, змінилось ${result.changed}` +
        (result.shipped > 0 ? `, замовлень відправлено ${result.shipped}` : "") +
        ".";
  return result;
}

export type TrackingStatus = { lastFinishedAt: string | null; lastChecked: number; active: number };

/** Стан трекінгу для екрана «Нова Пошта»: коли востаннє, скільки накладних відстежується. */
export async function getTrackingStatus(db: AnyPgDatabase): Promise<TrackingStatus> {
  const [state] = await db.select().from(npSyncState).where(eq(npSyncState.key, TRACKING_KEY));
  const active = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(
      and(isNotNull(shipments.ttnNumber), inArray(shipments.status, ACTIVE_SHIPMENT_STATUSES)),
    );
  return {
    lastFinishedAt: state?.lastFinishedAt?.toISOString() ?? null,
    lastChecked: state?.citiesCount ?? 0,
    active: active.length,
  };
}

/** «Оновити статус» однієї накладної з картки замовлення (право на накладні, своя локація). */
export async function refreshShipmentStatus(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
  api?: Options["api"],
): Promise<TrackingResult> {
  const [row] = await db.select().from(shipments).where(eq(shipments.orderId, orderId));
  if (!row) throw new ValidationError("ТТН для цього замовлення немає.");
  requirePermission(actor, "shipments", "write", { recordLocationId: row.locationId });
  if (!row.ttnNumber) throw new ValidationError("ТТН ще не створена.");
  const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ValidationError("Замовлення не знайдено.");
  return trackShipments(db, { shipmentIds: [row.id], api });
}
