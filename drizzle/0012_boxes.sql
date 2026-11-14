CREATE TYPE "public"."box_event_kind" AS ENUM('created', 'label_printed', 'issued', 'returned', 'sold', 'lost', 'found', 'transferred', 'note');--> statement-breakpoint
CREATE TYPE "public"."box_status" AS ENUM('in_stock', 'at_client', 'sold', 'lost', 'retired');--> statement-breakpoint
CREATE TABLE "box_debts_legacy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"box_type_id" uuid NOT NULL,
	"count" integer NOT NULL,
	"since_date" date,
	"source_row" text,
	"resolved_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_debts_legacy_count_ok" CHECK ("box_debts_legacy"."count" > 0),
	CONSTRAINT "box_debts_legacy_resolved_ok" CHECK ("box_debts_legacy"."resolved_count" >= 0 and "box_debts_legacy"."resolved_count" <= "box_debts_legacy"."count")
);
--> statement-breakpoint
ALTER TABLE "box_debts_legacy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "box_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" uuid NOT NULL,
	"event" "box_event_kind" NOT NULL,
	"order_id" uuid,
	"client_id" uuid,
	"location_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"device_queue_id" text,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "box_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"box_type_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" "box_status" DEFAULT 'in_stock' NOT NULL,
	"current_client_id" uuid,
	"current_order_id" uuid,
	"issued_at" timestamp with time zone,
	"label_printed_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"retire_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boxes_code_unique" UNIQUE("code"),
	CONSTRAINT "boxes_client_matches_status" CHECK (("boxes"."status" = 'at_client' and "boxes"."current_client_id" is not null and "boxes"."issued_at" is not null)
        or ("boxes"."status" <> 'at_client' and "boxes"."current_client_id" is null and "boxes"."current_order_id" is null))
);
--> statement-breakpoint
ALTER TABLE "boxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "box_prefix" text;--> statement-breakpoint
ALTER TABLE "box_debts_legacy" ADD CONSTRAINT "box_debts_legacy_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_debts_legacy" ADD CONSTRAINT "box_debts_legacy_box_type_id_box_types_id_fk" FOREIGN KEY ("box_type_id") REFERENCES "public"."box_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_events" ADD CONSTRAINT "box_events_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_events" ADD CONSTRAINT "box_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_events" ADD CONSTRAINT "box_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_events" ADD CONSTRAINT "box_events_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_events" ADD CONSTRAINT "box_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_box_type_id_box_types_id_fk" FOREIGN KEY ("box_type_id") REFERENCES "public"."box_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_current_client_id_clients_id_fk" FOREIGN KEY ("current_client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_current_order_id_orders_id_fk" FOREIGN KEY ("current_order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "box_debts_legacy_client_id_idx" ON "box_debts_legacy" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "box_debts_legacy_box_type_id_idx" ON "box_debts_legacy" USING btree ("box_type_id");--> statement-breakpoint
CREATE INDEX "box_events_box_occurred_idx" ON "box_events" USING btree ("box_id","occurred_at");--> statement-breakpoint
CREATE INDEX "box_events_order_id_idx" ON "box_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "box_events_client_id_idx" ON "box_events" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "box_events_location_id_idx" ON "box_events" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "box_events_actor_id_idx" ON "box_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "box_events_device_queue_id_key" ON "box_events" USING btree ("device_queue_id") WHERE "box_events"."device_queue_id" is not null;--> statement-breakpoint
CREATE INDEX "boxes_status_location_idx" ON "boxes" USING btree ("status","location_id");--> statement-breakpoint
CREATE INDEX "boxes_location_id_idx" ON "boxes" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "boxes_box_type_id_idx" ON "boxes" USING btree ("box_type_id");--> statement-breakpoint
CREATE INDEX "boxes_current_client_id_idx" ON "boxes" USING btree ("current_client_id");--> statement-breakpoint
CREATE INDEX "boxes_current_order_id_idx" ON "boxes" USING btree ("current_order_id");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_box_prefix_unique" UNIQUE("box_prefix");--> statement-breakpoint
-- Префікси кодів боксів для двох локацій (D104): Київ K, Львів L.
UPDATE "locations" SET "box_prefix" = 'K' WHERE "code" = 'kyiv';--> statement-breakpoint
UPDATE "locations" SET "box_prefix" = 'L' WHERE "code" = 'lviv';--> statement-breakpoint
-- Час останньої зміни рядка.
CREATE TRIGGER boxes_set_updated_at
  BEFORE UPDATE ON boxes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER box_debts_legacy_set_updated_at
  BEFORE UPDATE ON box_debts_legacy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Журнал змін (ТЗ 4.9): бокси, їхні події й ручні зміни старих боргів.
CREATE TRIGGER boxes_audit
  AFTER INSERT OR UPDATE OR DELETE ON boxes
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER box_events_audit
  AFTER INSERT ON box_events
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER box_debts_legacy_audit
  AFTER INSERT OR UPDATE OR DELETE ON box_debts_legacy
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
-- Події лише додаються: змінити чи видалити подію база не дозволить, помилку виправляє нова подія.
CREATE FUNCTION box_events_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Подію з боксом не змінюють і не видаляють: помилку виправляє нова подія.'
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION box_events_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER box_events_guard
  BEFORE UPDATE OR DELETE ON box_events
  FOR EACH ROW EXECUTE FUNCTION box_events_guard();
--> statement-breakpoint
-- Борги по боксах (ТЗ 4.4): на клієнта й тип = бокси «У клієнта» плюс старі борги мінус закриті.
CREATE VIEW box_debts WITH (security_invoker = true) AS
SELECT client_id,
       box_type_id,
       sum(qr_count)::int AS qr_count,
       sum(legacy_count)::int AS legacy_count,
       (sum(qr_count) + sum(legacy_count))::int AS total_count,
       min(oldest_at) AS oldest_at
  FROM (
    SELECT b.current_client_id AS client_id, b.box_type_id,
           count(*) AS qr_count, 0 AS legacy_count, min(b.issued_at) AS oldest_at
      FROM boxes b
     WHERE b.status = 'at_client'
     GROUP BY b.current_client_id, b.box_type_id
    UNION ALL
    SELECT l.client_id, l.box_type_id,
           0 AS qr_count, sum(l.count - l.resolved_count) AS legacy_count,
           min(l.since_date::timestamp AT TIME ZONE 'Europe/Kyiv') AS oldest_at
      FROM box_debts_legacy l
     WHERE l.count > l.resolved_count
     GROUP BY l.client_id, l.box_type_id
  ) debts
 GROUP BY client_id, box_type_id;
--> statement-breakpoint
-- Склад (ТЗ 4.4): скільки боксів у кожному статусі по локації й типу.
CREATE VIEW box_stock WITH (security_invoker = true) AS
SELECT location_id,
       box_type_id,
       count(*) FILTER (WHERE status = 'in_stock')::int AS in_stock,
       count(*) FILTER (WHERE status = 'at_client')::int AS at_client,
       count(*) FILTER (WHERE status = 'sold')::int AS sold,
       count(*) FILTER (WHERE status = 'lost')::int AS lost
  FROM boxes
 GROUP BY location_id, box_type_id;
