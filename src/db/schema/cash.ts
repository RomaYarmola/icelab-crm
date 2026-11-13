import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { money, pk, restrict, timestamps } from "./_common";
import { cashEntryVia } from "./enums";
import { orders } from "./orders";
import { locations, profiles } from "./reference";

/**
 * Готівка по замовленню (ТЗ 4.6, D67). Це журнал: запис додають, але не міняють і не видаляють.
 * Помилку виправляє сторно (`reversed_*`, лише власник, D69): запис лишається, але в підсумках не
 * рахується. Незмінність гарантує тригер бази, а не лише код.
 */
export const cashEntries = pgTable(
  "cash_entries",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, restrict),
    /** Локація замовлення на момент запису: за нею старший локації бачить свою касу. */
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, restrict),
    amount: money("amount").notNull(),
    /** Коли гроші прийнято (за київським часом), для підсумку «каса за день». */
    receivedOn: date("received_on").notNull(),
    /** Хто прийняв: вільний текст (наприклад, ім'я водія), якщо це не той, хто вносить запис. */
    receivedByText: text("received_by_text"),
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => profiles.id, restrict),
    enteredVia: cashEntryVia("entered_via").notNull().default("web"),
    note: text("note"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => profiles.id, restrict),
    reversalReason: text("reversal_reason"),
    ...timestamps,
  },
  (t) => [
    index("cash_entries_order_id_idx").on(t.orderId),
    index("cash_entries_location_received_idx").on(t.locationId, t.receivedOn),
    index("cash_entries_entered_by_idx").on(t.enteredBy),
    index("cash_entries_reversed_by_idx").on(t.reversedBy),
    check("cash_entries_amount_ok", sql`${t.amount} > 0`),
    // Сторно має автора й причину; без сторно цих полів немає.
    check(
      "cash_entries_reversal_ok",
      sql`(${t.reversedAt} is null and ${t.reversedBy} is null and ${t.reversalReason} is null)
        or (${t.reversedAt} is not null and ${t.reversedBy} is not null
            and length(btrim(coalesce(${t.reversalReason}, ''))) > 0)`,
    ),
  ],
).enableRLS();
