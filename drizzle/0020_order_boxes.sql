CREATE TABLE "order_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"box_type_id" uuid,
	"client_own_box_id" uuid,
	"count" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_boxes_count_ok" CHECK ("order_boxes"."count" > 0 and "order_boxes"."count" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "order_boxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_boxes" ADD CONSTRAINT "order_boxes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_boxes" ADD CONSTRAINT "order_boxes_box_type_id_box_types_id_fk" FOREIGN KEY ("box_type_id") REFERENCES "public"."box_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_boxes" ADD CONSTRAINT "order_boxes_client_own_box_id_client_own_boxes_id_fk" FOREIGN KEY ("client_own_box_id") REFERENCES "public"."client_own_boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_boxes_order_id_idx" ON "order_boxes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_boxes_box_type_id_idx" ON "order_boxes" USING btree ("box_type_id");--> statement-breakpoint
CREATE INDEX "order_boxes_client_own_box_id_idx" ON "order_boxes" USING btree ("client_own_box_id");--> statement-breakpoint
CREATE TRIGGER order_boxes_set_updated_at
  BEFORE UPDATE ON order_boxes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Наявні замовлення з тарою: один рядок з типом і кількістю (і бокс клієнта, якщо був обраний).
INSERT INTO "order_boxes" ("order_id", "box_type_id", "client_own_box_id", "count", "sort")
SELECT "id", "box_type_id", "client_own_box_id", "box_count", 0
FROM "orders"
WHERE "box_count" > 0 AND ("box_type_id" IS NOT NULL OR "client_own_box_id" IS NOT NULL);
