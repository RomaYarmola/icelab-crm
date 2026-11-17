CREATE TYPE "public"."integration_service" AS ENUM('np', 'monobank', 'telegram', 'claude', 'stt', 'site');--> statement-breakpoint
CREATE TYPE "public"."np_payer" AS ENUM('Sender', 'Recipient');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('draft', 'created', 'sent', 'arrived', 'received', 'returning', 'returned', 'refused', 'error');--> statement-breakpoint
CREATE TABLE "integration_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" "integration_service" NOT NULL,
	"operation" text NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"status" integer,
	"duration_ms" integer,
	"error_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "np_cities" (
	"ref" text PRIMARY KEY NOT NULL,
	"name_ua" text NOT NULL,
	"area_ua" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "np_cities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "np_warehouses" (
	"ref" text PRIMARY KEY NOT NULL,
	"city_ref" text NOT NULL,
	"name_ua" text NOT NULL,
	"number" text,
	"type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "np_warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"np_ref" text,
	"ttn_number" text,
	"status" "shipment_status" DEFAULT 'draft' NOT NULL,
	"status_code" text,
	"status_text" text,
	"cost_uah" numeric(10, 2),
	"payer" "np_payer" DEFAULT 'Recipient' NOT NULL,
	"recipient_city_ref" text,
	"recipient_warehouse_ref" text,
	"recipient_counterparty_ref" text,
	"recipient_contact_ref" text,
	"weight_kg" numeric(10, 3),
	"seats" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_in_np_at" timestamp with time zone,
	"last_tracked_at" timestamp with time zone,
	"error_text" text,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "shipments_ttn_number_unique" UNIQUE("ttn_number"),
	CONSTRAINT "shipments_seats_ok" CHECK ("shipments"."seats" >= 1),
	CONSTRAINT "shipments_weight_ok" CHECK ("shipments"."weight_kg" is null or "shipments"."weight_kg" > 0)
);
--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD COLUMN "np_counterparty_ref" text;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD COLUMN "np_contact_ref" text;--> statement-breakpoint
ALTER TABLE "box_types" ADD COLUMN "empty_weight_kg" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_logs_service_created_idx" ON "integration_logs" USING btree ("service","created_at");--> statement-breakpoint
CREATE INDEX "integration_logs_created_at_idx" ON "integration_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "np_cities_name_trgm_idx" ON "np_cities" USING gin ("name_ua" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "np_cities_synced_at_idx" ON "np_cities" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "np_warehouses_city_ref_idx" ON "np_warehouses" USING btree ("city_ref");--> statement-breakpoint
CREATE INDEX "np_warehouses_name_trgm_idx" ON "np_warehouses" USING gin ("name_ua" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "np_warehouses_synced_at_idx" ON "np_warehouses" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "shipments_location_id_idx" ON "shipments" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "shipments_status_tracked_idx" ON "shipments" USING btree ("status","last_tracked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_np_ref_key" ON "shipments" USING btree ("np_ref") WHERE "shipments"."np_ref" is not null;--> statement-breakpoint
-- Час останньої зміни накладної і запис змін у журнал (ТЗ 4.9). Журнал викликів і копії довідників
-- Нової Пошти не пишуть журналу: це технічні дані.
CREATE TRIGGER shipments_set_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER shipments_audit
  AFTER INSERT OR UPDATE OR DELETE ON shipments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
