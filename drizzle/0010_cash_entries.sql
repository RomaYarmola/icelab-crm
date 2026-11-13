CREATE TYPE "public"."cash_entry_via" AS ENUM('web', 'driver_bot');--> statement-breakpoint
CREATE TABLE "cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"received_on" date NOT NULL,
	"received_by_text" text,
	"entered_by" uuid NOT NULL,
	"entered_via" "cash_entry_via" DEFAULT 'web' NOT NULL,
	"note" text,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_entries_amount_ok" CHECK ("cash_entries"."amount" > 0),
	CONSTRAINT "cash_entries_reversal_ok" CHECK (("cash_entries"."reversed_at" is null and "cash_entries"."reversed_by" is null and "cash_entries"."reversal_reason" is null)
        or ("cash_entries"."reversed_at" is not null and "cash_entries"."reversed_by" is not null
            and length(btrim(coalesce("cash_entries"."reversal_reason", ''))) > 0))
);
--> statement-breakpoint
ALTER TABLE "cash_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_entered_by_profiles_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_reversed_by_profiles_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_entries_order_id_idx" ON "cash_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cash_entries_location_received_idx" ON "cash_entries" USING btree ("location_id","received_on");--> statement-breakpoint
CREATE INDEX "cash_entries_entered_by_idx" ON "cash_entries" USING btree ("entered_by");--> statement-breakpoint
CREATE INDEX "cash_entries_reversed_by_idx" ON "cash_entries" USING btree ("reversed_by");--> statement-breakpoint
-- Час останньої зміни рядка (змінюється лише при сторно).
CREATE TRIGGER cash_entries_set_updated_at
  BEFORE UPDATE ON cash_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Журнал змін: хто й коли додав запис готівки чи зробив сторно (ТЗ 4.9).
CREATE TRIGGER cash_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON cash_entries
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
-- Гроші це записи, а не поля (D67, D69): запис готівки не видаляють і не змінюють. Єдина дозволена
-- зміна: один раз поставити сторно (reversed_*). Це перевіряє база, тож жоден код цього не обійде.
CREATE FUNCTION cash_entries_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Запис готівки не видаляють: помилку виправляє сторно.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Запис готівки вже сторновано, змінити його не можна.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.received_on IS DISTINCT FROM OLD.received_on
    OR NEW.received_by_text IS DISTINCT FROM OLD.received_by_text
    OR NEW.entered_by IS DISTINCT FROM OLD.entered_by
    OR NEW.entered_via IS DISTINCT FROM OLD.entered_via
    OR NEW.note IS DISTINCT FROM OLD.note
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Запис готівки не змінюють: помилку виправляє сторно.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION cash_entries_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER cash_entries_guard
  BEFORE UPDATE OR DELETE ON cash_entries
  FOR EACH ROW EXECUTE FUNCTION cash_entries_guard();
