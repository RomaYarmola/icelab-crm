import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", [
  "owner",
  "manager",
  "location_lead",
  "production",
  "accountant",
  "driver",
]);

export const legalType = pgEnum("legal_type", ["person", "fop", "company"]);

export const addressKind = pgEnum("address_kind", [
  "delivery",
  "np_warehouse",
  "np_address",
  "bus",
]);

export const orderStatus = pgEnum("order_status", [
  "draft",
  "confirmed",
  "in_production",
  "packed",
  "shipped",
  "paid",
  "closed",
  "cancelled",
]);

export const deliveryMethod = pgEnum("delivery_method", [
  "pickup",
  "our_delivery",
  "np",
  "bus",
  "other",
]);

/** Нова Пошта: на відділення чи поштомат, або адресно кур'єром (Роман, 20.11.2026). */
export const npDeliveryKind = pgEnum("np_delivery_kind", ["warehouse", "courier"]);

export const boxOwnership = pgEnum("box_ownership", ["ours", "client", "sold"]);

export const orderItemKind = pgEnum("order_item_kind", ["ice", "delivery", "box_sale", "other"]);

/** Спосіб оплати замовлення. `unknown` до уточнення (питання 13 до замовника). */
export const paymentKind = pgEnum("payment_kind", ["cash", "fop", "company", "unknown"]);

/** Звідки внесено запис готівки: з веб-інтерфейсу чи через Telegram-бота водія (B12). */
export const cashEntryVia = pgEnum("cash_entry_via", ["web", "driver_bot"]);

export const auditAction = pgEnum("audit_action", ["insert", "update", "delete"]);

/** Що вивантажили в Excel: списки замовлень, клієнтів, готівки чи всі дані (B8, D95). */
export const exportKind = pgEnum("export_kind", [
  "orders",
  "clients",
  "cash",
  "all",
  "boxes",
  "box_debts",
  "box_stock",
  "shipments",
  "month_summary",
]);

/** Статус оборотного бокса (ТЗ 5.2): на складі, у клієнта, продано, втрачено, списано. */
export const boxStatus = pgEnum("box_status", ["in_stock", "at_client", "sold", "lost", "retired"]);

/** Подія з боксом (ТЗ 4.4). */
export const boxEventKind = pgEnum("box_event_kind", [
  "created",
  "label_printed",
  "issued",
  "returned",
  "sold",
  "lost",
  "found",
  "transferred",
  "note",
]);

/** Статус накладної Нової Пошти (ТЗ 5.4): чернетка, створена, далі за трекінгом, або помилка. */
export const shipmentStatus = pgEnum("shipment_status", [
  "draft",
  "created",
  "sent",
  "arrived",
  "received",
  "returning",
  "returned",
  "refused",
  "error",
]);

/** Хто платить за доставку (значення як у API Нової Пошти). */
export const npPayer = pgEnum("np_payer", ["Sender", "Recipient"]);

/** Зовнішній сервіс у журналі викликів (ТЗ §4). */
export const integrationService = pgEnum("integration_service", [
  "np",
  "monobank",
  "telegram",
  "claude",
  "stt",
  "site",
]);

/** Звідки заявка: група Telegram, форма на сайті чи голосове (B15). */
export const intakeChannel = pgEnum("intake_channel", ["telegram", "site", "voice"]);

/** Стан повідомлення-заявки (ТЗ 4.7): нове, розібрано, не вдалось, пропущено, підтверджено, відхилено. */
export const intakeParseStatus = pgEnum("intake_parse_status", [
  "new",
  "parsed",
  "failed",
  "skipped",
  "confirmed",
  "rejected",
]);

/** Стан зіставлення платежу із замовленням (B13, ТЗ 4.6): не зіставлено, само, вручну, ігноровано. */
export const paymentMatchStatus = pgEnum("payment_match_status", [
  "unmatched",
  "auto",
  "manual",
  "ignored",
]);

/** Звідки платіж: з API monobank чи з файла виписки. */
export const paymentImportedVia = pgEnum("payment_imported_via", ["api", "file"]);
