CREATE TABLE "regions" (
	"prefix" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "regions_prefix_format" CHECK ("regions"."prefix" ~ '^[А-ЯІЇЄҐ]{2}$')
);
--> statement-breakpoint
ALTER TABLE "regions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT "clients_code_format";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merged_into_id_clients_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_contacts_phone_trgm_idx" ON "client_contacts" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "client_contacts_name_trgm_idx" ON "client_contacts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_code_pattern_idx" ON "clients" USING btree ("code" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "clients_merged_into_id_idx" ON "clients" USING btree ("merged_into_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_not_merged_into_self" CHECK ("clients"."merged_into_id" is null or "clients"."merged_into_id" <> "clients"."id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merged_is_deleted" CHECK ("clients"."merged_into_id" is null or "clients"."deleted_at" is not null);--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_code_format" CHECK ("clients"."is_placeholder" or "clients"."code" ~ '^[А-ЯІЇЄҐ]{2}[0-9]+$' or ("clients"."code" ~ '^[0-9]+$' and "clients"."code" <> '404'));
--> statement-breakpoint
-- Журнал змін для прайсу, контактів і адрес клієнтів (раніше його вели лише clients і client_prices).
CREATE TRIGGER default_prices_audit
  AFTER INSERT OR UPDATE OR DELETE ON default_prices
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER client_contacts_audit
  AFTER INSERT OR UPDATE OR DELETE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER client_addresses_audit
  AFTER INSERT OR UPDATE OR DELETE ON client_addresses
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
