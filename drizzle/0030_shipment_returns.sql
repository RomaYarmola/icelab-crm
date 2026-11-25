CREATE TABLE "shipment_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"ttn_number" text,
	"location_id" uuid,
	"status" "shipment_status",
	"status_code" text,
	"status_text" text,
	"city" text,
	"warehouse_number" text,
	"warehouse_name" text,
	"arrived_at" timestamp with time zone,
	"paid_storage_from" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_returns_found_has_location" CHECK ("shipment_returns"."ttn_number" is null or "shipment_returns"."location_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "shipment_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipment_returns" ADD CONSTRAINT "shipment_returns_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_returns" ADD CONSTRAINT "shipment_returns_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_returns_shipment_id_key" ON "shipment_returns" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_returns_ttn_number_key" ON "shipment_returns" USING btree ("ttn_number") WHERE "shipment_returns"."ttn_number" is not null;--> statement-breakpoint
CREATE INDEX "shipment_returns_location_id_idx" ON "shipment_returns" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "shipment_returns_checked_at_idx" ON "shipment_returns" USING btree ("checked_at");