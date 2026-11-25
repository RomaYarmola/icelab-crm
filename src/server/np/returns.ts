import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { locations, shipmentReturns, shipments } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { callNp } from "./client";
import {
  lightReturnNumber,
  parseNpDate,
  RECHECK_HOURS,
  RETURN_WINDOW_DAYS,
  returnLocationId,
} from "./return-rules";
import { mapNpStatus, TRACKING_BATCH } from "./tracking";

/**
 * «Легкі повернення» (B17, D222–D227). Два кроки за один запуск: шукаємо повернення за отриманими
 * відправками (поле `LightReturnNumber` у трекінгу), потім оновлюємо статуси знайдених. Дані в
 * кабінеті Нової Пошти не змінюємо, імен і телефонів із відповіді не зберігаємо.
 */

/** Скільки відправок без повернення перевіряємо за запуск: функція розкладу має лише 10 секунд. */
export const DISCOVERY_LIMIT = 200;

type RawReturn = {
  Number?: string;
  StatusCode?: string | number;
  Status?: string;
  LightReturnNumber?: string;
  CityRecipient?: string;
  WarehouseRecipient?: string;
  WarehouseRecipientNumber?: string;
  ActualDeliveryDate?: string;
  DatePayedKeeping?: string;
};

export type ReturnsResult = { checked: number; found: number; tracked: number; closed: number };

type Options = { now?: Date; api?: Parameters<typeof callNp>[2] };

const clean = (value: unknown): string | null =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;

async function ask(db: AnyPgDatabase, numbers: string[], api: Options["api"]) {
  const response = await callNp<RawReturn>(
    db,
    {
      modelName: "TrackingDocument",
      calledMethod: "getStatusDocuments",
      methodProperties: {
        Documents: numbers.map((number) => ({ DocumentNumber: number, Phone: "" })),
      },
    },
    api,
  );
  return new Map(response.data.map((row) => [String(row.Number), row]));
}

const batches = <T>(rows: T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / TRACKING_BATCH) }, (_, index) =>
    rows.slice(index * TRACKING_BATCH, (index + 1) * TRACKING_BATCH),
  );

async function discover(db: AnyPgDatabase, now: Date, options: Options, result: ReturnsResult) {
  const since = new Date(now.getTime() - RETURN_WINDOW_DAYS * 86_400_000);
  const recheckBefore = new Date(now.getTime() - RECHECK_HOURS * 3_600_000);
  const candidates = await db
    .select({
      shipmentId: shipments.id,
      ttn: shipments.ttnNumber,
      locationId: shipments.locationId,
      knownReturn: shipmentReturns.ttnNumber,
    })
    .from(shipments)
    .leftJoin(shipmentReturns, eq(shipmentReturns.shipmentId, shipments.id))
    .where(
      and(
        isNotNull(shipments.ttnNumber),
        // 106 («одержано, створено зворотну доставку») у нас «returned»: посилку теж отримано.
        inArray(shipments.status, ["received", "returned"]),
        gte(shipments.createdInNpAt, since),
        or(
          isNull(shipmentReturns.id),
          and(
            lte(shipmentReturns.checkedAt, recheckBefore),
            or(
              isNull(shipmentReturns.ttnNumber),
              // Накладну повернення видалили: клієнт міг оформити нову.
              and(
                isNotNull(shipmentReturns.closedAt),
                or(isNull(shipmentReturns.status), ne(shipmentReturns.status, "received")),
              ),
            ),
          ),
        ),
      ),
    )
    .orderBy(sql`${shipmentReturns.checkedAt} asc nulls first`, shipments.createdInNpAt)
    .limit(DISCOVERY_LIMIT);

  for (const batch of batches(candidates)) {
    const byNumber = await ask(
      db,
      batch.map((row) => row.ttn!),
      options.api,
    );
    for (const row of batch) {
      const answer = byNumber.get(row.ttn!);
      if (!answer) continue;
      result.checked += 1;
      let found = lightReturnNumber(answer.LightReturnNumber, row.ttn!);
      if (found === row.knownReturn) found = null;
      if (found) {
        const [taken] = await db
          .select({ id: shipmentReturns.id })
          .from(shipmentReturns)
          .where(eq(shipmentReturns.ttnNumber, found));
        if (taken) found = null;
      }
      // Нове повернення починає з чистого стану; без нього міняємо лише час перевірки.
      const fresh = found
        ? {
            ttnNumber: found,
            locationId: row.locationId,
            status: null,
            statusCode: null,
            statusText: null,
            city: null,
            warehouseNumber: null,
            warehouseName: null,
            arrivedAt: null,
            paidStorageFrom: null,
            closedAt: null,
          }
        : {};
      await db
        .insert(shipmentReturns)
        .values({ shipmentId: row.shipmentId, checkedAt: now, ...fresh })
        .onConflictDoUpdate({
          target: shipmentReturns.shipmentId,
          set: { checkedAt: now, ...fresh },
        });
      if (found) result.found += 1;
    }
  }
}

async function refresh(db: AnyPgDatabase, now: Date, options: Options, result: ReturnsResult) {
  const open = await db
    .select({ row: shipmentReturns, shipmentLocationId: shipments.locationId })
    .from(shipmentReturns)
    .innerJoin(shipments, eq(shipments.id, shipmentReturns.shipmentId))
    .where(and(isNotNull(shipmentReturns.ttnNumber), isNull(shipmentReturns.closedAt)))
    .orderBy(shipmentReturns.createdAt);
  if (open.length === 0) return;
  const places = await db.select({ id: locations.id, name: locations.name }).from(locations);

  for (const batch of batches(open)) {
    const byNumber = await ask(
      db,
      batch.map(({ row }) => row.ttnNumber!),
      options.api,
    );
    for (const { row, shipmentLocationId } of batch) {
      const answer = byNumber.get(row.ttnNumber!);
      if (!answer) continue;
      result.tracked += 1;
      const code = String(answer.StatusCode ?? "");
      // Код 3 («номер не знайдено») тимчасовий для щойно створеної накладної: нічого не міняємо.
      if (code === "3") continue;
      const status = mapNpStatus(code) ?? row.status;
      const city = clean(answer.CityRecipient) ?? row.city;
      // Код 2: накладну видалено. Отримано: бокс уже забрали (D227).
      const closed = code === "2" || status === "received" || status === "returned";
      const arrivedAt =
        row.arrivedAt ??
        (status === "arrived" ? (parseNpDate(answer.ActualDeliveryDate) ?? now) : null);
      await db
        .update(shipmentReturns)
        .set({
          status,
          statusCode: code,
          statusText: clean(answer.Status),
          city,
          locationId: returnLocationId(city, places, shipmentLocationId),
          warehouseNumber: clean(answer.WarehouseRecipientNumber) ?? row.warehouseNumber,
          warehouseName: clean(answer.WarehouseRecipient) ?? row.warehouseName,
          arrivedAt,
          paidStorageFrom: parseNpDate(answer.DatePayedKeeping) ?? row.paidStorageFrom,
          closedAt: closed ? now : null,
        })
        .where(eq(shipmentReturns.id, row.id));
      if (closed) result.closed += 1;
    }
  }
}

/** Шукає нові повернення й оновлює відкриті. Помилку Нової Пошти кидає далі. */
export async function trackReturns(
  db: AnyPgDatabase,
  options: Options = {},
): Promise<ReturnsResult> {
  const now = options.now ?? new Date();
  const result: ReturnsResult = { checked: 0, found: 0, tracked: 0, closed: 0 };
  await discover(db, now, options, result);
  await refresh(db, now, options, result);
  return result;
}
