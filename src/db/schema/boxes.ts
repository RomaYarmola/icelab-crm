import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { pk, restrict, timestamps } from "./_common";
import { clients } from "./clients";
import { boxEventKind, boxStatus } from "./enums";
import { orders } from "./orders";
import { boxTypes, locations, profiles } from "./reference";

/**
 * Оборотні бокси (ТЗ 4.4, D104). Код `K-0001` видає сервер. Бокс «У клієнта» завжди має клієнта,
 * в інших статусах клієнта немає: це перевіряє база. Стан бокса міняє лише подія (`box_events`).
 */
export const boxes = pgTable(
  "boxes",
  {
    id: pk(),
    code: text("code").notNull().unique(),
    boxTypeId: uuid("box_type_id")
      .notNull()
      .references(() => boxTypes.id, restrict),
    /** Домашня локація бокса. */
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, restrict),
    status: boxStatus("status").notNull().default("in_stock"),
    currentClientId: uuid("current_client_id").references(() => clients.id, restrict),
    currentOrderId: uuid("current_order_id").references(() => orders.id, restrict),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    labelPrintedAt: timestamp("label_printed_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retireReason: text("retire_reason"),
    ...timestamps,
  },
  (t) => [
    index("boxes_status_location_idx").on(t.status, t.locationId),
    index("boxes_location_id_idx").on(t.locationId),
    index("boxes_box_type_id_idx").on(t.boxTypeId),
    index("boxes_current_client_id_idx").on(t.currentClientId),
    index("boxes_current_order_id_idx").on(t.currentOrderId),
    // «У клієнта» ⇔ є клієнт і дата видачі; в інших статусах клієнта й замовлення немає.
    check(
      "boxes_client_matches_status",
      sql`(${t.status} = 'at_client' and ${t.currentClientId} is not null and ${t.issuedAt} is not null)
        or (${t.status} <> 'at_client' and ${t.currentClientId} is null and ${t.currentOrderId} is null)`,
    ),
  ],
).enableRLS();

/**
 * Події з боксом (ТЗ 4.4): створено, надруковано, видано, повернено, продано… Лише додаються: змінити
 * чи видалити подію база не дозволить, помилку виправляє нова подія. `occurred_at` це час скана на
 * телефоні, `recorded_at` час запису на сервері. `device_queue_id` робить повторну відправку з
 * офлайн-черги безпечною (унікальний, коли заданий).
 */
export const boxEvents = pgTable(
  "box_events",
  {
    id: pk(),
    boxId: uuid("box_id")
      .notNull()
      .references(() => boxes.id, restrict),
    event: boxEventKind("event").notNull(),
    orderId: uuid("order_id").references(() => orders.id, restrict),
    clientId: uuid("client_id").references(() => clients.id, restrict),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, restrict),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id, restrict),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    deviceQueueId: text("device_queue_id"),
    note: text("note"),
  },
  (t) => [
    index("box_events_box_occurred_idx").on(t.boxId, t.occurredAt),
    index("box_events_order_id_idx").on(t.orderId),
    index("box_events_client_id_idx").on(t.clientId),
    index("box_events_location_id_idx").on(t.locationId),
    index("box_events_actor_id_idx").on(t.actorId),
    uniqueIndex("box_events_device_queue_id_key")
      .on(t.deviceQueueId)
      .where(sql`${t.deviceQueueId} is not null`),
  ],
).enableRLS();

/**
 * Старі борги по боксах «за таблицею» (ТЗ 4.4, D114): бокси без наклейок, які ще в клієнтів.
 * Закриваються вручну (`resolved_count`).
 */
export const boxDebtsLegacy = pgTable(
  "box_debts_legacy",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, restrict),
    boxTypeId: uuid("box_type_id")
      .notNull()
      .references(() => boxTypes.id, restrict),
    count: integer("count").notNull(),
    sinceDate: date("since_date"),
    sourceRow: text("source_row"),
    resolvedCount: integer("resolved_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("box_debts_legacy_client_id_idx").on(t.clientId),
    index("box_debts_legacy_box_type_id_idx").on(t.boxTypeId),
    check("box_debts_legacy_count_ok", sql`${t.count} > 0`),
    check(
      "box_debts_legacy_resolved_ok",
      sql`${t.resolvedCount} >= 0 and ${t.resolvedCount} <= ${t.count}`,
    ),
  ],
).enableRLS();
