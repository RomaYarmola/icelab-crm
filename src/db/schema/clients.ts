import { sql } from "drizzle-orm";
import {
  boolean,
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
import { kg, money, percent, pk, restrict, timestamps } from "./_common";
import { addressKind, legalType } from "./enums";
import {
  boxTypes,
  clientApplications,
  clientStatuses,
  createdBy,
  iceTypes,
  orderSources,
  profiles,
} from "./reference";

// Клієнти і ціни (розділ 4.2 ТЗ).

export const clients = pgTable(
  "clients",
  {
    id: pk(),
    /** Код вигляду АА21 (кирилиця). Унікальний і серед видалених клієнтів. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    legalType: legalType("legal_type"),
    edrpou: text("edrpou"),
    iceTypeId: uuid("ice_type_id").references(() => iceTypes.id, restrict),
    applicationId: uuid("application_id").references(() => clientApplications.id, restrict),
    statusId: uuid("status_id").references(() => clientStatuses.id, restrict),
    managerId: uuid("manager_id").references(() => profiles.id, restrict),
    sourceId: uuid("source_id").references(() => orderSources.id, restrict),
    defaultBoxTypeId: uuid("default_box_type_id").references(() => boxTypes.id, restrict),
    markupPercentOverride: percent("markup_percent_override"),
    notes: text("notes"),
    inactiveDaysThreshold: integer("inactive_days_threshold"),
    /** Клієнт-заглушка «Новий клієнт»: для нього формат коду не перевіряється. */
    isPlaceholder: boolean("is_placeholder").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("clients_code_uq").on(t.code),
    // Пошук за назвою (потрібне розширення pg_trgm, див. міграцію 0000).
    index("clients_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    index("clients_ice_type_id_idx").on(t.iceTypeId),
    index("clients_application_id_idx").on(t.applicationId),
    index("clients_status_id_idx").on(t.statusId),
    index("clients_manager_id_idx").on(t.managerId),
    index("clients_source_id_idx").on(t.sourceId),
    index("clients_default_box_type_id_idx").on(t.defaultBoxTypeId),
    index("clients_created_by_idx").on(t.createdBy),
    // Дві великі кириличні літери й цифри. Латиниця відхиляється (її нормалізує код у B4 і B7).
    check("clients_code_format", sql`${t.isPlaceholder} or ${t.code} ~ '^[А-ЯІЇЄҐ]{2}[0-9]+$'`),
    check(
      "clients_markup_range",
      sql`${t.markupPercentOverride} is null or (${t.markupPercentOverride} >= 0 and ${t.markupPercentOverride} <= 100)`,
    ),
    check(
      "clients_inactive_days_positive",
      sql`${t.inactiveDaysThreshold} is null or ${t.inactiveDaysThreshold} > 0`,
    ),
  ],
).enableRLS();

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name"),
    /** Телефон у форматі E.164 (+380...). */
    phone: text("phone"),
    role: text("role"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("client_contacts_client_id_idx").on(t.clientId),
    index("client_contacts_phone_idx").on(t.phone),
    index("client_contacts_created_by_idx").on(t.createdBy),
    check("client_contacts_phone_e164", sql`${t.phone} is null or ${t.phone} ~ '^[+][0-9]{8,15}$'`),
  ],
).enableRLS();

export const clientAddresses = pgTable(
  "client_addresses",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: addressKind("kind").notNull(),
    label: text("label"),
    cityText: text("city_text"),
    addressText: text("address_text"),
    recipientName: text("recipient_name"),
    npCityRef: text("np_city_ref"),
    npWarehouseRef: text("np_warehouse_ref"),
    npWarehouseNumber: text("np_warehouse_number"),
    /** Вікно доставки, наприклад «9-11». */
    timeWindow: text("time_window"),
    isDefault: boolean("is_default").notNull().default(false),
    /** Реквізити Нової Пошти зіставлено зі довідниками. */
    isResolved: boolean("is_resolved").notNull().default(false),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("client_addresses_client_id_idx").on(t.clientId),
    index("client_addresses_created_by_idx").on(t.createdBy),
    // Одна адреса за замовчуванням на клієнта.
    uniqueIndex("client_addresses_default_uq")
      .on(t.clientId)
      .where(sql`${t.isDefault}`),
  ],
).enableRLS();

/**
 * Індивідуальні ціни клієнта. Поточна ціна: запис із `valid_to is null` і найбільшим
 * `min_kg`, що не перевищує кількість. Зміна ціни: закрити стару (`valid_to`) і додати нову.
 */
export const clientPrices = pgTable(
  "client_prices",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Порожній тип льоду означає «для будь-якого типу». */
    iceTypeId: uuid("ice_type_id").references(() => iceTypes.id, restrict),
    pricePerKg: money("price_per_kg").notNull(),
    minKg: kg("min_kg").notNull().default("0"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("client_prices_lookup_idx").on(t.clientId, t.iceTypeId, t.validFrom),
    index("client_prices_ice_type_id_idx").on(t.iceTypeId),
    index("client_prices_created_by_idx").on(t.createdBy),
    // Одна поточна ціна на клієнта, тип льоду (включно з «будь-який») і ступінь обсягу.
    uniqueIndex("client_prices_current_uq")
      .on(
        t.clientId,
        sql`coalesce(${t.iceTypeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.minKg,
      )
      .where(sql`${t.validTo} is null`),
    check("client_prices_period_ok", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    check("client_prices_values_ok", sql`${t.minKg} >= 0 and ${t.pricePerKg} >= 0`),
  ],
).enableRLS();
