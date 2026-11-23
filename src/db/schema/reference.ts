import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { kg, money, pk, restrict, timestamps } from "./_common";
import { userRole } from "./enums";

// Довідники й налаштування (розділ 4.1 ТЗ).
// RLS увімкнено на всіх таблицях. Політик поки немає: таблиці закриті для Data API до блоку B2.

export const locations = pgTable("locations", {
  id: pk(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  npSenderRef: text("np_sender_ref"),
  npSenderContactRef: text("np_sender_contact_ref"),
  npSenderAddressRef: text("np_sender_address_ref"),
  npSenderPhone: text("np_sender_phone"),
  addressText: text("address_text"),
  /** Префікс кодів боксів локації: `K-0001` для Києва, `L-0001` для Львова (D104). */
  boxPrefix: text("box_prefix").unique(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}).enableRLS();

/**
 * Профіль користувача. До блоку B2 це просто `uuid` без зв'язку з `auth.users`:
 * зв'язок із Supabase Auth і створення профілю при реєстрації додаємо в B2.
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    fullName: text("full_name").notNull(),
    role: userRole("role").notNull(),
    locationId: uuid("location_id").references(() => locations.id, restrict),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).unique(),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("profiles_location_id_idx").on(t.locationId),
    // Для старшого локації, виробництва і водія локація обов'язкова.
    check(
      "profiles_location_required",
      sql`${t.role} not in ('location_lead', 'production', 'driver') or ${t.locationId} is not null`,
    ),
  ],
).enableRLS();

/** Автор запису: заповнюється тригером із `app.actor_id`, якщо не заданий явно. */
export const createdBy = () => uuid("created_by").references(() => profiles.id, restrict);

export const iceTypes = pgTable("ice_types", {
  id: pk(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  ...timestamps,
}).enableRLS();

export const boxTypes = pgTable("box_types", {
  id: pk(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  volumeL: integer("volume_l"),
  capacityKg: kg("capacity_kg"),
  /** Вага порожнього бокса, кг: додається до ваги посилки в накладній Нової Пошти (D127). */
  emptyWeightKg: kg("empty_weight_kg"),
  /** Зовнішні розміри, мм (для об'ємної ваги накладної, D158). */
  heightMm: integer("height_mm"),
  widthMm: integer("width_mm"),
  lengthMm: integer("length_mm"),
  isReturnable: boolean("is_returnable").notNull().default(true),
  isClientOwned: boolean("is_client_owned").notNull().default(false),
  salePrice: money("sale_price"),
  isActive: boolean("is_active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  ...timestamps,
}).enableRLS();

export const orderSources = pgTable("order_sources", {
  id: pk(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}).enableRLS();

export const clientStatuses = pgTable("client_statuses", {
  id: pk(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps,
}).enableRLS();

export const clientApplications = pgTable("client_applications", {
  id: pk(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps,
}).enableRLS();

/**
 * Області для коду клієнта (D24): дві літери з автомобільних номерів України і назва регіону.
 * Список готовий і затверджений Романом, нові префікси вручну не додаються. Префікс кирилицею.
 */
export const regions = pgTable(
  "regions",
  {
    prefix: text("prefix").primaryKey(),
    name: text("name").notNull(),
    /** Порядок у списку вибору: спершу найчастіші (Київ, Київська, Львівська), решта за назвою. */
    sort: integer("sort").notNull().default(0),
  },
  (t) => [check("regions_prefix_format", sql`${t.prefix} ~ '^[А-ЯІЇЄҐ]{2}$'`)],
).enableRLS();

/** Налаштування у вигляді «ключ → значення». */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps,
}).enableRLS();

/** Ціни за замовчуванням, коли в клієнта немає індивідуальної. */
export const defaultPrices = pgTable(
  "default_prices",
  {
    id: pk(),
    iceTypeId: uuid("ice_type_id")
      .notNull()
      .references(() => iceTypes.id, restrict),
    minKg: kg("min_kg").notNull().default("0"),
    pricePerKg: money("price_per_kg").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    ...timestamps,
  },
  (t) => [
    index("default_prices_ice_type_id_idx").on(t.iceTypeId),
    // Одна поточна ціна на тип льоду й ступінь обсягу.
    uniqueIndex("default_prices_current_uq")
      .on(t.iceTypeId, t.minKg)
      .where(sql`${t.validTo} is null`),
    check("default_prices_period_ok", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    check("default_prices_values_ok", sql`${t.minKg} >= 0 and ${t.pricePerKg} >= 0`),
  ],
).enableRLS();

/**
 * Довідник товарів (D174): лід, бокси, рідкий азот і майбутні. Тип льоду й тип бокса лишаються
 * окремими довідниками, а товар каже, що це за вид, у чому рахуємо, чи виробляє цех і якими
 * способами доставки його можна віддати (`null` означає «усіма»).
 */
export const products = pgTable(
  "products",
  {
    id: pk(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    unit: text("unit").notNull().default("шт"),
    producedByWorkshop: boolean("produced_by_workshop").notNull().default(false),
    allowedDeliveryMethods: text("allowed_delivery_methods").array(),
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    ...timestamps,
  },
  (t) => [check("products_kind_ok", sql`${t.kind} in ('ice', 'box', 'other')`)],
).enableRLS();

/**
 * Ціни товарів з історією «нова ціна від дати» (D45): для боксів по типу бокса, для товарів без
 * типів (рідкий азот) без типу. Лід має власний прайс (`default_prices`).
 */
export const productPrices = pgTable(
  "product_prices",
  {
    id: pk(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, restrict),
    boxTypeId: uuid("box_type_id").references(() => boxTypes.id, restrict),
    pricePerUnit: money("price_per_unit").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    ...timestamps,
  },
  (t) => [
    index("product_prices_product_id_idx").on(t.productId),
    index("product_prices_box_type_id_idx").on(t.boxTypeId),
    // Одна поточна ціна на товар (без типу) і на тип бокса.
    uniqueIndex("product_prices_current_uq")
      .on(t.productId)
      .where(sql`${t.validTo} is null and ${t.boxTypeId} is null`),
    uniqueIndex("product_prices_current_box_uq")
      .on(t.productId, t.boxTypeId)
      .where(sql`${t.validTo} is null and ${t.boxTypeId} is not null`),
    check("product_prices_period_ok", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    check("product_prices_value_ok", sql`${t.pricePerUnit} >= 0`),
  ],
).enableRLS();
