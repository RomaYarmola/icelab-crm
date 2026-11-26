import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { kg, money, pk, restrict, timestamps } from "./_common";
import { locations, profiles } from "./reference";

/**
 * Сировина CO2 для фінрезультату (B15, D232, D233, D240). Зберігаємо лише внесене людьми; залишок,
 * списання й вартість щоразу рахуються з цих рядків і замовлень.
 */

const location = () =>
  uuid("location_id")
    .notNull()
    .references(() => locations.id, restrict);
const createdBy = () => uuid("created_by").references(() => profiles.id, restrict);

/** Прихід CO2: одна поставка з кількістю й ціною за кг. */
export const co2Receipts = pgTable(
  "co2_receipts",
  {
    id: pk(),
    locationId: location(),
    receivedOn: date("received_on").notNull(),
    kg: kg("kg").notNull(),
    pricePerKg: money("price_per_kg").notNull(),
    note: text("note"),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("co2_receipts_location_date_idx").on(t.locationId, t.receivedOn),
    index("co2_receipts_created_by_idx").on(t.createdBy),
    check("co2_receipts_values_ok", sql`${t.kg} > 0 and ${t.pricePerKg} > 0`),
  ],
).enableRLS();

/** Норма: скільки кг CO2 іде на 1 кг льоду в місті, з якої дати. */
export const co2Norms = pgTable(
  "co2_norms",
  {
    id: pk(),
    locationId: location(),
    validFrom: date("valid_from").notNull(),
    norm: numeric("norm", { precision: 6, scale: 3 }).notNull(),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("co2_norms_location_date_key").on(t.locationId, t.validFrom),
    index("co2_norms_created_by_idx").on(t.createdBy),
    check("co2_norms_positive", sql`${t.norm} > 0`),
  ],
).enableRLS();

/** Ручне виправлення залишку: різниця між фактичним і порахованим, з приміткою. */
export const co2Adjustments = pgTable(
  "co2_adjustments",
  {
    id: pk(),
    locationId: location(),
    adjustedOn: date("adjusted_on").notNull(),
    /** Зі знаком: додатне додає на склад, від'ємне прибирає. */
    kg: kg("kg").notNull(),
    note: text("note").notNull(),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("co2_adjustments_location_date_idx").on(t.locationId, t.adjustedOn),
    index("co2_adjustments_created_by_idx").on(t.createdBy),
    check("co2_adjustments_values_ok", sql`${t.kg} <> 0 and ${t.note} <> ''`),
  ],
).enableRLS();

/** Викинутий лід (D240): CO2 на нього списується за тією самою нормою. */
export const iceWriteoffs = pgTable(
  "ice_writeoffs",
  {
    id: pk(),
    locationId: location(),
    writtenOffOn: date("written_off_on").notNull(),
    kg: kg("kg").notNull(),
    note: text("note"),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    index("ice_writeoffs_location_date_idx").on(t.locationId, t.writtenOffOn),
    index("ice_writeoffs_created_by_idx").on(t.createdBy),
    check("ice_writeoffs_positive", sql`${t.kg} > 0`),
  ],
).enableRLS();

/** Статті інших витрат і доходів (D236): власник додає й вимикає. */
export const ledgerCategories = pgTable(
  "ledger_categories",
  {
    id: pk(),
    name: text("name").notNull(),
    /** `expense` витрата, `income` інший дохід. */
    kind: text("kind").notNull().default("expense"),
    /** Однакова щомісяця: суму минулого місяця підставляємо у форму. */
    repeatsMonthly: boolean("repeats_monthly").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(100),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("ledger_categories_name_key").on(sql`lower(${t.name})`),
    check(
      "ledger_categories_values_ok",
      sql`${t.kind} in ('expense', 'income') and ${t.name} <> ''`,
    ),
  ],
).enableRLS();

/** Сума статті за місяць: по місту або спільна (`location_id` порожній, ТЗ 4.8). */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: pk(),
    /** Перше число місяця. */
    month: date("month").notNull(),
    locationId: uuid("location_id").references(() => locations.id, restrict),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => ledgerCategories.id, restrict),
    amount: money("amount").notNull(),
    note: text("note"),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("ledger_entries_location_key")
      .on(t.month, t.categoryId, t.locationId)
      .where(sql`${t.locationId} is not null`),
    uniqueIndex("ledger_entries_common_key")
      .on(t.month, t.categoryId)
      .where(sql`${t.locationId} is null`),
    index("ledger_entries_location_id_idx").on(t.locationId),
    index("ledger_entries_category_id_idx").on(t.categoryId),
    index("ledger_entries_created_by_idx").on(t.createdBy),
    check("ledger_entries_values_ok", sql`${t.amount} >= 0 and extract(day from ${t.month}) = 1`),
  ],
).enableRLS();

/** Ставка комісійних менеджера за 1 кг «на продаж», з місяця (D237). */
export const commissionRates = pgTable(
  "commission_rates",
  {
    id: pk(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, restrict),
    validFrom: date("valid_from").notNull(),
    ratePerKg: money("rate_per_kg").notNull(),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("commission_rates_profile_month_key").on(t.profileId, t.validFrom),
    index("commission_rates_created_by_idx").on(t.createdBy),
    check(
      "commission_rates_values_ok",
      sql`${t.ratePerKg} >= 0 and extract(day from ${t.validFrom}) = 1`,
    ),
  ],
).enableRLS();

/** Курс долара за місяць (D238), вносить власник. */
export const fxRates = pgTable(
  "fx_rates",
  {
    id: pk(),
    month: date("month").notNull(),
    usdRate: numeric("usd_rate", { precision: 10, scale: 4 }).notNull(),
    createdBy: createdBy(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("fx_rates_month_key").on(t.month),
    index("fx_rates_created_by_idx").on(t.createdBy),
    check("fx_rates_values_ok", sql`${t.usdRate} > 0 and extract(day from ${t.month}) = 1`),
  ],
).enableRLS();

/** Закритий місяць (D234): зафіксовані цифри. Відкриття місяця видаляє рядок. */
export const financeMonths = pgTable(
  "finance_months",
  {
    id: pk(),
    month: date("month").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("finance_months_month_key").on(t.month),
    index("finance_months_created_by_idx").on(t.createdBy),
    check("finance_months_first_day", sql`extract(day from ${t.month}) = 1`),
  ],
).enableRLS();
