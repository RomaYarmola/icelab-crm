CREATE TABLE "order_price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"old_price" numeric(10, 2) NOT NULL,
	"new_price" numeric(10, 2) NOT NULL,
	"note" text NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_price_changes_values_ok" CHECK ("order_price_changes"."old_price" >= 0 and "order_price_changes"."new_price" >= 0),
	CONSTRAINT "order_price_changes_note_ok" CHECK (length(btrim("order_price_changes"."note")) > 0)
);
--> statement-breakpoint
ALTER TABLE "order_price_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "price_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "order_price_changes" ADD CONSTRAINT "order_price_changes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_price_changes" ADD CONSTRAINT "order_price_changes_changed_by_profiles_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_price_changes_order_id_idx" ON "order_price_changes" USING btree ("order_id","changed_at");--> statement-breakpoint
CREATE INDEX "order_price_changes_changed_by_idx" ON "order_price_changes" USING btree ("changed_by");--> statement-breakpoint
CREATE INDEX "orders_client_date_idx" ON "orders" USING btree ("client_id","order_date");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_has_price" CHECK ("orders"."status" in ('draft', 'cancelled') or "orders"."is_archive" or "orders"."price_per_kg_snapshot" is not null);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_has_reason" CHECK ("orders"."status" <> 'cancelled' or "orders"."is_archive" or length(btrim(coalesce("orders"."cancel_reason", ''))) > 0);--> statement-breakpoint
-- Журнал змін для змін ціни підтверджених замовлень (D52): так само, як для решти таблиць замовлень.
CREATE TRIGGER order_price_changes_audit
  AFTER INSERT OR UPDATE OR DELETE ON order_price_changes
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
