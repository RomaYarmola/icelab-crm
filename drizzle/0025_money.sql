CREATE TYPE "public"."payment_imported_via" AS ENUM('api', 'file');--> statement-breakpoint
CREATE TYPE "public"."payment_match_status" AS ENUM('unmatched', 'auto', 'manual', 'ignored');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'monobank' NOT NULL,
	"account_id" text NOT NULL,
	"label" text NOT NULL,
	"currency" text DEFAULT 'UAH' NOT NULL,
	"is_fop" boolean DEFAULT true NOT NULL,
	"token_ref" text DEFAULT 'MONOPAY_API_KEY' NOT NULL,
	"last_statement_to" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_fop_only" CHECK ("bank_accounts"."is_fop")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"matched_by" uuid,
	"rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_matches_amount_positive" CHECK ("payment_matches"."amount" > 0),
	CONSTRAINT "payment_matches_rule_ok" CHECK ("payment_matches"."rule" in ('comment_number', 'amount_date_name', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "payment_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid,
	"external_id" text,
	"dedupe_hash" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'UAH' NOT NULL,
	"description" text,
	"counter_name" text,
	"counter_iban" text,
	"comment" text,
	"raw" jsonb,
	"match_status" "payment_match_status" DEFAULT 'unmatched' NOT NULL,
	"ignored_reason" text,
	"imported_via" "payment_imported_via" DEFAULT 'api' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_has_identity" CHECK ("payments"."external_id" is not null or "payments"."dedupe_hash" is not null),
	CONSTRAINT "payments_ignored_reason" CHECK ("payments"."match_status" <> 'ignored' or ("payments"."ignored_reason" is not null and "payments"."ignored_reason" <> ''))
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_matched_by_profiles_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_provider_account_key" ON "bank_accounts" USING btree ("provider","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_matches_payment_order_key" ON "payment_matches" USING btree ("payment_id","order_id");--> statement-breakpoint
CREATE INDEX "payment_matches_order_id_idx" ON "payment_matches" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_matches_matched_by_idx" ON "payment_matches" USING btree ("matched_by");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_external_id_key" ON "payments" USING btree ("bank_account_id","external_id") WHERE "payments"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_dedupe_hash_key" ON "payments" USING btree ("dedupe_hash") WHERE "payments"."dedupe_hash" is not null;--> statement-breakpoint
CREATE INDEX "payments_occurred_at_idx" ON "payments" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "payments_match_status_idx" ON "payments" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX "payments_amount_idx" ON "payments" USING btree ("amount");--> statement-breakpoint
CREATE INDEX "payments_bank_account_id_idx" ON "payments" USING btree ("bank_account_id");--> statement-breakpoint
-- Час зміни рахунку й платежу; журнал змін для платежів і зіставлень (ТЗ 4.9). Рахунок технічний, його стан синхронізації змінюється щоп'ятнадцять хвилин, тому журналу на ньому немає.
CREATE TRIGGER bank_accounts_set_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER payment_matches_audit
  AFTER INSERT OR UPDATE OR DELETE ON payment_matches
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
