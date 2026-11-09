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

export const boxOwnership = pgEnum("box_ownership", ["ours", "client", "sold"]);

export const orderItemKind = pgEnum("order_item_kind", ["ice", "delivery", "box_sale", "other"]);

/** Спосіб оплати замовлення. `unknown` до уточнення (питання 13 до замовника). */
export const paymentKind = pgEnum("payment_kind", ["cash", "fop", "company", "unknown"]);

export const auditAction = pgEnum("audit_action", ["insert", "update", "delete"]);
