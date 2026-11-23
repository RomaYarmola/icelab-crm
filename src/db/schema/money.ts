import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { money, pk, restrict, timestamps } from "./_common";
import { paymentImportedVia, paymentMatchStatus } from "./enums";
import { orders } from "./orders";
import { profiles } from "./reference";

/**
 * Безготівкові оплати (B13, ТЗ 4.6, 8.5). Токена monobank тут немає: лише в змінних середовища.
 * Зберігаємо тільки рахунок ФОП (D186): особисті рахунки з того ж токена в базу не потрапляють.
 */

/** Рахунок, з якого забираємо виписку. */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: pk(),
    provider: text("provider").notNull().default("monobank"),
    /** Ідентифікатор рахунку в monobank (з `client-info`). */
    accountId: text("account_id").notNull(),
    label: text("label").notNull(),
    currency: text("currency").notNull().default("UAH"),
    isFop: boolean("is_fop").notNull().default(true),
    /** Назва змінної середовища з токеном, не сам токен. */
    tokenRef: text("token_ref").notNull().default("MONOPAY_API_KEY"),
    /** До якого моменту виписку вже забрано. */
    lastStatementTo: timestamp("last_statement_to", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Текст останньої помилки синхронізації; `null`, якщо остання вдалась. */
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("bank_accounts_provider_account_key").on(t.provider, t.accountId),
    check("bank_accounts_fop_only", sql`${t.isFop}`),
  ],
).enableRLS();

/** Надходження на рахунок. `external_id` з API й `dedupe_hash` з файла відсікають дублі. */
export const payments = pgTable(
  "payments",
  {
    id: pk(),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id, restrict),
    externalId: text("external_id"),
    /** Хеш (дата, сума, опис) для платежів з файла, де немає id операції. */
    dedupeHash: text("dedupe_hash"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("UAH"),
    description: text("description"),
    counterName: text("counter_name"),
    counterIban: text("counter_iban"),
    comment: text("comment"),
    raw: jsonb("raw"),
    matchStatus: paymentMatchStatus("match_status").notNull().default("unmatched"),
    /** Чому платіж ігноровано (обов'язково для статусу «ігноровано»). */
    ignoredReason: text("ignored_reason"),
    importedVia: paymentImportedVia("imported_via").notNull().default("api"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payments_external_id_key")
      .on(t.bankAccountId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    uniqueIndex("payments_dedupe_hash_key")
      .on(t.dedupeHash)
      .where(sql`${t.dedupeHash} is not null`),
    index("payments_occurred_at_idx").on(t.occurredAt),
    index("payments_match_status_idx").on(t.matchStatus),
    index("payments_amount_idx").on(t.amount),
    index("payments_bank_account_id_idx").on(t.bankAccountId),
    check("payments_amount_positive", sql`${t.amount} > 0`),
    check("payments_has_identity", sql`${t.externalId} is not null or ${t.dedupeHash} is not null`),
    check(
      "payments_ignored_reason",
      sql`${t.matchStatus} <> 'ignored' or (${t.ignoredReason} is not null and ${t.ignoredReason} <> '')`,
    ),
  ],
).enableRLS();

/** Яка частина платежу пішла на яке замовлення. `matched_by` порожній для автозіставлення. */
export const paymentMatches = pgTable(
  "payment_matches",
  {
    id: pk(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, restrict),
    amount: money("amount").notNull(),
    matchedBy: uuid("matched_by").references(() => profiles.id, restrict),
    /** `comment_number`, `amount_date_name` чи `manual`. */
    rule: text("rule").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_matches_payment_order_key").on(t.paymentId, t.orderId),
    index("payment_matches_order_id_idx").on(t.orderId),
    index("payment_matches_matched_by_idx").on(t.matchedBy),
    check("payment_matches_amount_positive", sql`${t.amount} > 0`),
    check(
      "payment_matches_rule_ok",
      sql`${t.rule} in ('comment_number', 'amount_date_name', 'manual')`,
    ),
  ],
).enableRLS();
