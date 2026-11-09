CREATE TYPE "public"."address_kind" AS ENUM('delivery', 'np_warehouse', 'np_address', 'bus');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."box_ownership" AS ENUM('ours', 'client', 'sold');--> statement-breakpoint
CREATE TYPE "public"."delivery_method" AS ENUM('pickup', 'our_delivery', 'np', 'bus', 'other');--> statement-breakpoint
CREATE TYPE "public"."legal_type" AS ENUM('person', 'fop', 'company');--> statement-breakpoint
CREATE TYPE "public"."order_item_kind" AS ENUM('ice', 'delivery', 'box_sale', 'other');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'confirmed', 'in_production', 'packed', 'shipped', 'paid', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('cash', 'fop', 'company', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'location_lead', 'production', 'accountant', 'driver');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"diff" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "address_kind" NOT NULL,
	"label" text,
	"city_text" text,
	"address_text" text,
	"recipient_name" text,
	"np_city_ref" text,
	"np_warehouse_ref" text,
	"np_warehouse_number" text,
	"time_window" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_contacts_phone_e164" CHECK ("client_contacts"."phone" is null or "client_contacts"."phone" ~ '^[+][0-9]{8,15}$')
);
--> statement-breakpoint
ALTER TABLE "client_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"ice_type_id" uuid,
	"price_per_kg" numeric(10, 2) NOT NULL,
	"min_kg" numeric(10, 3) DEFAULT '0' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_prices_period_ok" CHECK ("client_prices"."valid_to" is null or "client_prices"."valid_to" >= "client_prices"."valid_from"),
	CONSTRAINT "client_prices_values_ok" CHECK ("client_prices"."min_kg" >= 0 and "client_prices"."price_per_kg" >= 0)
);
--> statement-breakpoint
ALTER TABLE "client_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"legal_type" "legal_type",
	"edrpou" text,
	"ice_type_id" uuid,
	"application_id" uuid,
	"status_id" uuid,
	"manager_id" uuid,
	"source_id" uuid,
	"default_box_type_id" uuid,
	"markup_percent_override" numeric(5, 2),
	"notes" text,
	"inactive_days_threshold" integer,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_code_format" CHECK ("clients"."is_placeholder" or "clients"."code" ~ '^[А-ЯІЇЄҐ]{2}[0-9]+$'),
	CONSTRAINT "clients_markup_range" CHECK ("clients"."markup_percent_override" is null or ("clients"."markup_percent_override" >= 0 and "clients"."markup_percent_override" <= 100)),
	CONSTRAINT "clients_inactive_days_positive" CHECK ("clients"."inactive_days_threshold" is null or "clients"."inactive_days_threshold" > 0)
);
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_item_kind" NOT NULL,
	"title" text NOT NULL,
	"qty" numeric(10, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'шт' NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(10, 2) GENERATED ALWAYS AS (round("qty" * "price", 2)) STORED NOT NULL,
	"box_type_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_values_ok" CHECK ("order_items"."qty" >= 0 and "order_items"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "order_status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED BY DEFAULT AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"location_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"source_id" uuid,
	"order_date" date NOT NULL,
	"ice_type_id" uuid,
	"kg_sold" numeric(10, 3) DEFAULT '0' NOT NULL,
	"kg_to_produce" numeric(10, 3) DEFAULT '0' NOT NULL,
	"markup_percent_applied" numeric(5, 2),
	"price_per_kg_snapshot" numeric(10, 2),
	"delivery_method" "delivery_method" DEFAULT 'other' NOT NULL,
	"address_id" uuid,
	"delivery_text" text,
	"time_window" text,
	"recipient_name" text,
	"recipient_phone" text,
	"box_type_id" uuid,
	"box_count" integer DEFAULT 0 NOT NULL,
	"box_ownership" "box_ownership" DEFAULT 'ours' NOT NULL,
	"comment" text,
	"internal_comment" text,
	"payment_kind" "payment_kind" DEFAULT 'unknown' NOT NULL,
	"total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"produced_at" timestamp with time zone,
	"packed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"seen_by_production_at" timestamp with time zone,
	"telegram_message_id" bigint,
	"telegram_chat_id" bigint,
	"draft_payload" jsonb,
	"duplicate_of" uuid,
	"is_archive" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_kg_sold_ok" CHECK ("orders"."kg_sold" >= 0),
	CONSTRAINT "orders_kg_to_produce_ok" CHECK ("orders"."kg_to_produce" >= 0),
	CONSTRAINT "orders_box_count_ok" CHECK ("orders"."box_count" >= 0),
	CONSTRAINT "orders_total_ok" CHECK ("orders"."total" >= 0),
	CONSTRAINT "orders_markup_range" CHECK ("orders"."markup_percent_applied" is null or ("orders"."markup_percent_applied" >= 0 and "orders"."markup_percent_applied" <= 100)),
	CONSTRAINT "orders_recipient_phone_e164" CHECK ("orders"."recipient_phone" is null or "orders"."recipient_phone" ~ '^[+][0-9]{8,15}$')
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "box_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"volume_l" integer,
	"capacity_kg" numeric(10, 3),
	"is_returnable" boolean DEFAULT true NOT NULL,
	"is_client_owned" boolean DEFAULT false NOT NULL,
	"sale_price" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "box_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_applications_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "client_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "client_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "default_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ice_type_id" uuid NOT NULL,
	"min_kg" numeric(10, 3) DEFAULT '0' NOT NULL,
	"price_per_kg" numeric(10, 2) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "default_prices_period_ok" CHECK ("default_prices"."valid_to" is null or "default_prices"."valid_to" >= "default_prices"."valid_from"),
	CONSTRAINT "default_prices_values_ok" CHECK ("default_prices"."min_kg" >= 0 and "default_prices"."price_per_kg" >= 0)
);
--> statement-breakpoint
ALTER TABLE "default_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ice_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ice_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "ice_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"np_sender_ref" text,
	"np_sender_contact_ref" text,
	"np_sender_address_ref" text,
	"np_sender_phone" text,
	"address_text" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_sources_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "order_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"location_id" uuid,
	"telegram_user_id" bigint,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_telegram_user_id_unique" UNIQUE("telegram_user_id"),
	CONSTRAINT "profiles_location_required" CHECK ("profiles"."role" not in ('location_lead', 'production', 'driver') or "profiles"."location_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_prices" ADD CONSTRAINT "client_prices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_prices" ADD CONSTRAINT "client_prices_ice_type_id_ice_types_id_fk" FOREIGN KEY ("ice_type_id") REFERENCES "public"."ice_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_prices" ADD CONSTRAINT "client_prices_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_ice_type_id_ice_types_id_fk" FOREIGN KEY ("ice_type_id") REFERENCES "public"."ice_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_application_id_client_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."client_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_status_id_client_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."client_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_manager_id_profiles_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_source_id_order_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."order_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_default_box_type_id_box_types_id_fk" FOREIGN KEY ("default_box_type_id") REFERENCES "public"."box_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_box_type_id_box_types_id_fk" FOREIGN KEY ("box_type_id") REFERENCES "public"."box_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_profiles_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_id_order_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."order_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ice_type_id_ice_types_id_fk" FOREIGN KEY ("ice_type_id") REFERENCES "public"."ice_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_client_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."client_addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_box_type_id_box_types_id_fk" FOREIGN KEY ("box_type_id") REFERENCES "public"."box_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_profiles_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_duplicate_of_orders_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "default_prices" ADD CONSTRAINT "default_prices_ice_type_id_ice_types_id_fk" FOREIGN KEY ("ice_type_id") REFERENCES "public"."ice_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_table_row_idx" ON "audit_log" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "client_addresses_client_id_idx" ON "client_addresses" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_addresses_created_by_idx" ON "client_addresses" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "client_addresses_default_uq" ON "client_addresses" USING btree ("client_id") WHERE "client_addresses"."is_default";--> statement-breakpoint
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_contacts_phone_idx" ON "client_contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "client_contacts_created_by_idx" ON "client_contacts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "client_prices_lookup_idx" ON "client_prices" USING btree ("client_id","ice_type_id","valid_from");--> statement-breakpoint
CREATE INDEX "client_prices_ice_type_id_idx" ON "client_prices" USING btree ("ice_type_id");--> statement-breakpoint
CREATE INDEX "client_prices_created_by_idx" ON "client_prices" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "client_prices_current_uq" ON "client_prices" USING btree ("client_id",coalesce("ice_type_id", '00000000-0000-0000-0000-000000000000'::uuid),"min_kg") WHERE "client_prices"."valid_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_code_uq" ON "clients" USING btree ("code");--> statement-breakpoint
CREATE INDEX "clients_name_trgm_idx" ON "clients" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_ice_type_id_idx" ON "clients" USING btree ("ice_type_id");--> statement-breakpoint
CREATE INDEX "clients_application_id_idx" ON "clients" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "clients_status_id_idx" ON "clients" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "clients_manager_id_idx" ON "clients" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "clients_source_id_idx" ON "clients" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "clients_default_box_type_id_idx" ON "clients" USING btree ("default_box_type_id");--> statement-breakpoint
CREATE INDEX "clients_created_by_idx" ON "clients" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_box_type_id_idx" ON "order_items" USING btree ("box_type_id");--> statement-breakpoint
CREATE INDEX "order_items_created_by_idx" ON "order_items" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_idx" ON "order_status_history" USING btree ("order_id","changed_at");--> statement-breakpoint
CREATE INDEX "order_status_history_changed_by_idx" ON "order_status_history" USING btree ("changed_by");--> statement-breakpoint
CREATE INDEX "orders_location_date_status_idx" ON "orders" USING btree ("location_id","order_date","status");--> statement-breakpoint
CREATE INDEX "orders_client_id_idx" ON "orders" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_source_id_idx" ON "orders" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "orders_ice_type_id_idx" ON "orders" USING btree ("ice_type_id");--> statement-breakpoint
CREATE INDEX "orders_address_id_idx" ON "orders" USING btree ("address_id");--> statement-breakpoint
CREATE INDEX "orders_box_type_id_idx" ON "orders" USING btree ("box_type_id");--> statement-breakpoint
CREATE INDEX "orders_confirmed_by_idx" ON "orders" USING btree ("confirmed_by");--> statement-breakpoint
CREATE INDEX "orders_duplicate_of_idx" ON "orders" USING btree ("duplicate_of");--> statement-breakpoint
CREATE INDEX "orders_created_by_idx" ON "orders" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "default_prices_ice_type_id_idx" ON "default_prices" USING btree ("ice_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "default_prices_current_uq" ON "default_prices" USING btree ("ice_type_id","min_kg") WHERE "default_prices"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "profiles_location_id_idx" ON "profiles" USING btree ("location_id");