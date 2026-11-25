import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { kg, money, pk, restrict, timestamps } from "./_common";
import { integrationService, npPayer, shipmentStatus } from "./enums";
import { orders } from "./orders";
import { locations } from "./reference";

/**
 * Нова Пошта (B10, ТЗ 4.5 і 8.4). Копії довідників міст і відділень, накладні (ТТН) і журнал
 * викликів зовнішніх сервісів. API-ключа тут немає: він лише в змінних середовища (D122).
 */

/** Журнал викликів зовнішніх сервісів (ТЗ §4): без ключів і без адрес зі стікером. Чистимо за 90 днів. */
export const integrationLogs = pgTable(
  "integration_logs",
  {
    id: pk(),
    service: integrationService("service").notNull(),
    operation: text("operation").notNull(),
    request: jsonb("request"),
    response: jsonb("response"),
    /** HTTP-статус відповіді; `null`, якщо відповіді не було (обрив зв'язку, таймаут). */
    status: integer("status"),
    durationMs: integer("duration_ms"),
    errorText: text("error_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("integration_logs_service_created_idx").on(t.service, t.createdAt),
    index("integration_logs_created_at_idx").on(t.createdAt),
  ],
).enableRLS();

/** Копія довідника міст Нової Пошти (оновлюється щодоби, D125). */
export const npCities = pgTable(
  "np_cities",
  {
    ref: text("ref").primaryKey(),
    nameUa: text("name_ua").notNull(),
    areaUa: text("area_ua"),
    isActive: boolean("is_active").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("np_cities_name_trgm_idx").using("gin", sql`${t.nameUa} gin_trgm_ops`),
    index("np_cities_synced_at_idx").on(t.syncedAt),
  ],
).enableRLS();

/** Копія довідника відділень Нової Пошти. */
export const npWarehouses = pgTable(
  "np_warehouses",
  {
    ref: text("ref").primaryKey(),
    cityRef: text("city_ref").notNull(),
    nameUa: text("name_ua").notNull(),
    number: text("number"),
    type: text("type"),
    isActive: boolean("is_active").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("np_warehouses_city_ref_idx").on(t.cityRef),
    index("np_warehouses_name_trgm_idx").using("gin", sql`${t.nameUa} gin_trgm_ops`),
    index("np_warehouses_synced_at_idx").on(t.syncedAt),
  ],
).enableRLS();

/**
 * Накладна Нової Пошти на замовлення (ТЗ 4.5 і 5.4). Одне замовлення має не більше однієї ТТН.
 * `request_payload` і `response_payload` зберігаються без ключа, для розбору помилок.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, restrict),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, restrict),
    npRef: text("np_ref"),
    ttnNumber: text("ttn_number").unique(),
    status: shipmentStatus("status").notNull().default("draft"),
    statusCode: text("status_code"),
    statusText: text("status_text"),
    costUah: money("cost_uah"),
    payer: npPayer("payer").notNull().default("Recipient"),
    recipientCityRef: text("recipient_city_ref"),
    recipientWarehouseRef: text("recipient_warehouse_ref"),
    recipientCounterpartyRef: text("recipient_counterparty_ref"),
    recipientContactRef: text("recipient_contact_ref"),
    weightKg: kg("weight_kg"),
    seats: integer("seats").notNull().default(1),
    description: text("description"),
    createdInNpAt: timestamp("created_in_np_at", { withTimezone: true }),
    lastTrackedAt: timestamp("last_tracked_at", { withTimezone: true }),
    errorText: text("error_text"),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    ...timestamps,
  },
  (t) => [
    index("shipments_location_id_idx").on(t.locationId),
    index("shipments_status_tracked_idx").on(t.status, t.lastTrackedAt),
    uniqueIndex("shipments_np_ref_key")
      .on(t.npRef)
      .where(sql`${t.npRef} is not null`),
    check("shipments_seats_ok", sql`${t.seats} >= 1`),
    check("shipments_weight_ok", sql`${t.weightKg} is null or ${t.weightKg} > 0`),
  ],
).enableRLS();

/**
 * «Легке повернення» за нашою накладною (B17, D222). Рядок з'являється після першої перевірки
 * відправки; `ttn_number` порожній, доки клієнт не оформив повернення. Це копія даних Нової Пошти,
 * яку розклад постійно оновлює, тому журналу змін на неї немає. Імен і телефонів не зберігаємо.
 */
export const shipmentReturns = pgTable(
  "shipment_returns",
  {
    id: pk(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    ttnNumber: text("ttn_number"),
    /** Місто, чий це список (D223): за містом отримання повернення, інакше локація відправки. */
    locationId: uuid("location_id").references(() => locations.id, restrict),
    status: shipmentStatus("status"),
    statusCode: text("status_code"),
    statusText: text("status_text"),
    city: text("city"),
    warehouseNumber: text("warehouse_number"),
    warehouseName: text("warehouse_name"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    paidStorageFrom: timestamp("paid_storage_from", { withTimezone: true }),
    /** Коли повернення прибрали зі списку: отримано чи накладну видалено (D227). */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Коли востаннє питали Нову Пошту про повернення за цією відправкою. */
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipment_returns_shipment_id_key").on(t.shipmentId),
    uniqueIndex("shipment_returns_ttn_number_key")
      .on(t.ttnNumber)
      .where(sql`${t.ttnNumber} is not null`),
    index("shipment_returns_location_id_idx").on(t.locationId),
    index("shipment_returns_checked_at_idx").on(t.checkedAt),
    check(
      "shipment_returns_found_has_location",
      sql`${t.ttnNumber} is null or ${t.locationId} is not null`,
    ),
  ],
).enableRLS();

/**
 * Стан оновлення довідників (D125): де зупинилось порційне завантаження. Окрема таблиця, а не
 * `settings`: запис змінюється після кожної сторінки, і журнал змін від цього захлинувся б.
 * Один рядок з ключем `directories`.
 */
export const npSyncState = pgTable(
  "np_sync_state",
  {
    key: text("key").primaryKey(),
    /** `idle` (нічого не робимо), `cities` або `warehouses` (завантаження триває). */
    phase: text("phase").notNull().default("idle"),
    /** Наступна сторінка, яку треба завантажити. */
    page: integer("page").notNull().default(1),
    runStartedAt: timestamp("run_started_at", { withTimezone: true }),
    lastFinishedAt: timestamp("last_finished_at", { withTimezone: true }),
    citiesCount: integer("cities_count").notNull().default(0),
    warehousesCount: integer("warehouses_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("np_sync_state_phase_ok", sql`${t.phase} in ('idle', 'cities', 'warehouses')`)],
).enableRLS();
