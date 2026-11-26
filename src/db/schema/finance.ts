import { sql } from "drizzle-orm";
import { check, date, index, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
