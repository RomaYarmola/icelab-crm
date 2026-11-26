CREATE TABLE "commission_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"rate_per_kg" numeric(10, 2) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rates_values_ok" CHECK ("commission_rates"."rate_per_kg" >= 0 and extract(day from "commission_rates"."valid_from") = 1)
);
--> statement-breakpoint
ALTER TABLE "commission_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "finance_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "finance_months_first_day" CHECK (extract(day from "finance_months"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "finance_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"usd_rate" numeric(10, 4) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_values_ok" CHECK ("fx_rates"."usd_rate" > 0 and extract(day from "fx_rates"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "fx_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"repeats_monthly" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_categories_values_ok" CHECK ("ledger_categories"."kind" in ('expense', 'income') and "ledger_categories"."name" <> '')
);
--> statement-breakpoint
ALTER TABLE "ledger_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"location_id" uuid,
	"category_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_values_ok" CHECK ("ledger_entries"."amount" >= 0 and extract(day from "ledger_entries"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_months" ADD CONSTRAINT "finance_months_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_category_id_ledger_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ledger_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rates_profile_month_key" ON "commission_rates" USING btree ("profile_id","valid_from");--> statement-breakpoint
CREATE INDEX "commission_rates_created_by_idx" ON "commission_rates" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_months_month_key" ON "finance_months" USING btree ("month");--> statement-breakpoint
CREATE INDEX "finance_months_created_by_idx" ON "finance_months" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_month_key" ON "fx_rates" USING btree ("month");--> statement-breakpoint
CREATE INDEX "fx_rates_created_by_idx" ON "fx_rates" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_categories_name_key" ON "ledger_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_location_key" ON "ledger_entries" USING btree ("month","category_id","location_id") WHERE "ledger_entries"."location_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_common_key" ON "ledger_entries" USING btree ("month","category_id") WHERE "ledger_entries"."location_id" is null;--> statement-breakpoint
CREATE INDEX "ledger_entries_location_id_idx" ON "ledger_entries" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_category_id_idx" ON "ledger_entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_created_by_idx" ON "ledger_entries" USING btree ("created_by");
--> statement-breakpoint
-- Час зміни, автор і журнал змін (ТЗ 4.9).
CREATE TRIGGER ledger_categories_set_updated_at
  BEFORE UPDATE ON ledger_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER ledger_categories_audit
  AFTER INSERT OR UPDATE OR DELETE ON ledger_categories
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_set_updated_at
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_set_created_by
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER commission_rates_set_updated_at
  BEFORE UPDATE ON commission_rates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER commission_rates_set_created_by
  BEFORE INSERT ON commission_rates
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER commission_rates_audit
  AFTER INSERT OR UPDATE OR DELETE ON commission_rates
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER fx_rates_set_updated_at
  BEFORE UPDATE ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER fx_rates_set_created_by
  BEFORE INSERT ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER fx_rates_audit
  AFTER INSERT OR UPDATE OR DELETE ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER finance_months_set_created_by
  BEFORE INSERT ON finance_months
  FOR EACH ROW EXECUTE FUNCTION set_created_by();
--> statement-breakpoint
CREATE TRIGGER finance_months_audit
  AFTER INSERT OR UPDATE OR DELETE ON finance_months
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
-- Статті з відповідей Романа (повідомлення 14); «доставка водіями» не потрібна (D241).
INSERT INTO ledger_categories (name, kind, repeats_monthly, sort) VALUES
  ('Зарплати й премії', 'expense', true, 10),
  ('Бухгалтер', 'expense', true, 20),
  ('Податки', 'expense', false, 30),
  ('Оренда бочки', 'expense', false, 40),
  ('Інтернет', 'expense', false, 50),
  ('GPS', 'expense', false, 60),
  ('1С і каса', 'expense', false, 70),
  ('Реклама', 'expense', false, 80),
  ('Паливо', 'expense', false, 90),
  ('Ремонт авто', 'expense', false, 100),
  ('Продукти', 'expense', false, 110),
  ('Електроенергія', 'expense', false, 120),
  ('Закупівля боксів', 'expense', false, 130),
  ('Інші витрати', 'expense', false, 140),
  ('Інші доходи', 'income', false, 150);
