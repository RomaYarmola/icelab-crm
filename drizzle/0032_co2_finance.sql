CREATE TABLE "co2_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"adjusted_on" date NOT NULL,
	"kg" numeric(10, 3) NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "co2_adjustments_values_ok" CHECK ("co2_adjustments"."kg" <> 0 and "co2_adjustments"."note" <> '')
);
--> statement-breakpoint
ALTER TABLE "co2_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "co2_norms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"norm" numeric(6, 3) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "co2_norms_positive" CHECK ("co2_norms"."norm" > 0)
);
--> statement-breakpoint
ALTER TABLE "co2_norms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "co2_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"kg" numeric(10, 3) NOT NULL,
	"price_per_kg" numeric(10, 2) NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "co2_receipts_values_ok" CHECK ("co2_receipts"."kg" > 0 and "co2_receipts"."price_per_kg" > 0)
);
--> statement-breakpoint
ALTER TABLE "co2_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ice_writeoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"written_off_on" date NOT NULL,
	"kg" numeric(10, 3) NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ice_writeoffs_positive" CHECK ("ice_writeoffs"."kg" > 0)
);
--> statement-breakpoint
ALTER TABLE "ice_writeoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "co2_adjustments" ADD CONSTRAINT "co2_adjustments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co2_adjustments" ADD CONSTRAINT "co2_adjustments_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co2_norms" ADD CONSTRAINT "co2_norms_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co2_norms" ADD CONSTRAINT "co2_norms_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co2_receipts" ADD CONSTRAINT "co2_receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co2_receipts" ADD CONSTRAINT "co2_receipts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ice_writeoffs" ADD CONSTRAINT "ice_writeoffs_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ice_writeoffs" ADD CONSTRAINT "ice_writeoffs_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "co2_adjustments_location_date_idx" ON "co2_adjustments" USING btree ("location_id","adjusted_on");--> statement-breakpoint
CREATE INDEX "co2_adjustments_created_by_idx" ON "co2_adjustments" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "co2_norms_location_date_key" ON "co2_norms" USING btree ("location_id","valid_from");--> statement-breakpoint
CREATE INDEX "co2_norms_created_by_idx" ON "co2_norms" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "co2_receipts_location_date_idx" ON "co2_receipts" USING btree ("location_id","received_on");--> statement-breakpoint
CREATE INDEX "co2_receipts_created_by_idx" ON "co2_receipts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ice_writeoffs_location_date_idx" ON "ice_writeoffs" USING btree ("location_id","written_off_on");--> statement-breakpoint
CREATE INDEX "ice_writeoffs_created_by_idx" ON "ice_writeoffs" USING btree ("created_by");
--> statement-breakpoint
-- Час зміни, автор і журнал змін (ТЗ 4.9) на всіх чотирьох таблицях.
CREATE TRIGGER co2_receipts_set_updated_at
  BEFORE UPDATE ON co2_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER co2_receipts_set_created_by
  BEFORE INSERT ON co2_receipts
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER co2_receipts_audit
  AFTER INSERT OR UPDATE OR DELETE ON co2_receipts
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER co2_norms_set_updated_at
  BEFORE UPDATE ON co2_norms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER co2_norms_set_created_by
  BEFORE INSERT ON co2_norms
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER co2_norms_audit
  AFTER INSERT OR UPDATE OR DELETE ON co2_norms
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER co2_adjustments_set_updated_at
  BEFORE UPDATE ON co2_adjustments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER co2_adjustments_set_created_by
  BEFORE INSERT ON co2_adjustments
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER co2_adjustments_audit
  AFTER INSERT OR UPDATE OR DELETE ON co2_adjustments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER ice_writeoffs_set_updated_at
  BEFORE UPDATE ON ice_writeoffs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER ice_writeoffs_set_created_by
  BEFORE INSERT ON ice_writeoffs
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER ice_writeoffs_audit
  AFTER INSERT OR UPDATE OR DELETE ON ice_writeoffs
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
-- Норми, підтверджені Романом (D232): Київ 2,7, Львів 2,5 кг CO2 на 1 кг льоду.
INSERT INTO co2_norms (location_id, valid_from, norm)
SELECT l.id, DATE '2026-01-01', v.norm
  FROM (VALUES ('kyiv', 2.7), ('lviv', 2.5)) AS v(code, norm)
  JOIN locations l ON l.code = v.code;
