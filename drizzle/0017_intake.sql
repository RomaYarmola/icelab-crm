CREATE TYPE "public"."intake_channel" AS ENUM('telegram', 'site', 'voice');--> statement-breakpoint
CREATE TYPE "public"."intake_parse_status" AS ENUM('new', 'parsed', 'failed', 'skipped', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TABLE "intake_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "intake_channel" DEFAULT 'telegram' NOT NULL,
	"telegram_chat_id" bigint,
	"telegram_message_id" bigint,
	"telegram_thread_id" bigint,
	"telegram_user_id" bigint,
	"location_id" uuid,
	"text" text DEFAULT '' NOT NULL,
	"voice_file_id" text,
	"transcript" text,
	"parse_status" "intake_parse_status" DEFAULT 'new' NOT NULL,
	"skip_reason" text,
	"parse_result" jsonb,
	"parse_error" text,
	"order_id" uuid,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(10, 5),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"order_id" uuid,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intake_messages" ADD CONSTRAINT "intake_messages_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_messages" ADD CONSTRAINT "intake_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_leads" ADD CONSTRAINT "site_leads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_messages_chat_message_key" ON "intake_messages" USING btree ("telegram_chat_id","telegram_message_id") WHERE "intake_messages"."telegram_chat_id" is not null and "intake_messages"."telegram_message_id" is not null;--> statement-breakpoint
CREATE INDEX "intake_messages_status_created_idx" ON "intake_messages" USING btree ("parse_status","created_at");--> statement-breakpoint
CREATE INDEX "intake_messages_order_id_idx" ON "intake_messages" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "intake_messages_location_id_idx" ON "intake_messages" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_leads_dedupe_key_key" ON "site_leads" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "site_leads_order_id_idx" ON "site_leads" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "site_leads_received_at_idx" ON "site_leads" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_profile_id_idx" ON "telegram_link_codes" USING btree ("profile_id");--> statement-breakpoint
-- Час останньої зміни повідомлення-заявки. Журналу змін на вхідних таблицях немає (див. схему).
CREATE TRIGGER intake_messages_set_updated_at
  BEFORE UPDATE ON intake_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
