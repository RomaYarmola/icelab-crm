CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"box_type_id" uuid,
	"price_per_unit" numeric(10, 2) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_period_ok" CHECK ("product_prices"."valid_to" is null or "product_prices"."valid_to" >= "product_prices"."valid_from"),
	CONSTRAINT "product_prices_value_ok" CHECK ("product_prices"."price_per_unit" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text DEFAULT 'шт' NOT NULL,
	"produced_by_workshop" boolean DEFAULT false NOT NULL,
	"allowed_delivery_methods" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code"),
	CONSTRAINT "products_kind_ok" CHECK ("products"."kind" in ('ice', 'box', 'other'))
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_box_type_id_box_types_id_fk" FOREIGN KEY ("box_type_id") REFERENCES "public"."box_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_prices_product_id_idx" ON "product_prices" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_prices_box_type_id_idx" ON "product_prices" USING btree ("box_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_current_uq" ON "product_prices" USING btree ("product_id") WHERE "product_prices"."valid_to" is null and "product_prices"."box_type_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_current_box_uq" ON "product_prices" USING btree ("product_id","box_type_id") WHERE "product_prices"."valid_to" is null and "product_prices"."box_type_id" is not null;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_product_id_idx" ON "order_items" USING btree ("product_id");
--> statement-breakpoint
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_prices_set_updated_at
  BEFORE UPDATE ON product_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Журнал змін цін товарів (як у прайсу льоду).
CREATE TRIGGER product_prices_audit
  AFTER INSERT OR UPDATE OR DELETE ON product_prices
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
-- Початкові товари (D174): лід і бокси. Рідкий азот додаємо окремим кроком.
INSERT INTO "products" ("code", "name", "kind", "unit", "produced_by_workshop", "sort") VALUES
  ('ice', 'Лід', 'ice', 'кг', true, 1),
  ('box', 'Бокси', 'box', 'шт', false, 2)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- Старі позиції замовлень: лід і продаж боксів прив'язуємо до товару за видом.
UPDATE "order_items" SET "product_id" = (SELECT "id" FROM "products" WHERE "code" = 'ice') WHERE "kind" = 'ice';
--> statement-breakpoint
UPDATE "order_items" SET "product_id" = (SELECT "id" FROM "products" WHERE "code" = 'box') WHERE "kind" = 'box_sale';
