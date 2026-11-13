CREATE TYPE "public"."export_kind" AS ENUM('orders', 'clients', 'cash', 'all');--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "export_kind" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_row_count_ok" CHECK ("exports"."row_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exports_created_at_idx" ON "exports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "exports_created_by_idx" ON "exports" USING btree ("created_by");--> statement-breakpoint
-- Журнал змін: кожен експорт видно власнику й бухгалтеру в «Ще → Журнал змін» (D95).
CREATE TRIGGER exports_audit
  AFTER INSERT ON exports
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
-- Журнал експортів лише додається: запис не змінюють і не видаляють. Це перевіряє база, тож жоден код
-- цього не обійде (як для готівки, D67).
CREATE FUNCTION exports_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Запис журналу експортів не змінюють і не видаляють.'
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION exports_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER exports_guard
  BEFORE UPDATE OR DELETE ON exports
  FOR EACH ROW EXECUTE FUNCTION exports_guard();
