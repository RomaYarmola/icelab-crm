CREATE TYPE "public"."np_delivery_kind" AS ENUM('warehouse', 'courier');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "np_delivery_kind" "np_delivery_kind";
--> statement-breakpoint
-- Наявні замовлення Нової Пошти вважаємо відправкою на відділення (кур'єрську ще не підтримували).
UPDATE "orders" SET "np_delivery_kind" = CASE WHEN "address_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "client_addresses" a WHERE a."id" = "orders"."address_id" AND a."kind" = 'np_address') THEN 'courier'::np_delivery_kind ELSE 'warehouse'::np_delivery_kind END WHERE "delivery_method" = 'np';
