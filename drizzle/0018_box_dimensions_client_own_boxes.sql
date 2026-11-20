CREATE TABLE "client_own_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"volume_l" integer,
	"capacity_kg" numeric(10, 3),
	"empty_weight_kg" numeric(10, 3),
	"height_mm" integer,
	"width_mm" integer,
	"length_mm" integer,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_own_boxes_positive" CHECK (("client_own_boxes"."volume_l" is null or "client_own_boxes"."volume_l" > 0)
        and ("client_own_boxes"."capacity_kg" is null or "client_own_boxes"."capacity_kg" > 0)
        and ("client_own_boxes"."empty_weight_kg" is null or "client_own_boxes"."empty_weight_kg" >= 0)
        and ("client_own_boxes"."height_mm" is null or "client_own_boxes"."height_mm" > 0)
        and ("client_own_boxes"."width_mm" is null or "client_own_boxes"."width_mm" > 0)
        and ("client_own_boxes"."length_mm" is null or "client_own_boxes"."length_mm" > 0))
);
--> statement-breakpoint
ALTER TABLE "client_own_boxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "client_own_box_id" uuid;--> statement-breakpoint
ALTER TABLE "box_types" ADD COLUMN "height_mm" integer;--> statement-breakpoint
ALTER TABLE "box_types" ADD COLUMN "width_mm" integer;--> statement-breakpoint
ALTER TABLE "box_types" ADD COLUMN "length_mm" integer;--> statement-breakpoint
ALTER TABLE "client_own_boxes" ADD CONSTRAINT "client_own_boxes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_own_boxes" ADD CONSTRAINT "client_own_boxes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_own_boxes_client_id_idx" ON "client_own_boxes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_own_boxes_created_by_idx" ON "client_own_boxes" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_own_box_id_client_own_boxes_id_fk" FOREIGN KEY ("client_own_box_id") REFERENCES "public"."client_own_boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_client_own_box_id_idx" ON "orders" USING btree ("client_own_box_id");--> statement-breakpoint
-- Власні бокси клієнта (D164): час зміни, автор і журнал змін, як у адрес клієнта.
CREATE TRIGGER client_own_boxes_set_updated_at
  BEFORE UPDATE ON client_own_boxes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER client_own_boxes_set_created_by
  BEFORE INSERT ON client_own_boxes
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER client_own_boxes_audit
  AFTER INSERT OR UPDATE OR DELETE ON client_own_boxes
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
