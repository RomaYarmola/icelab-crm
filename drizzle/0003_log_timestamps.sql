ALTER TABLE "audit_log" ALTER COLUMN "at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "order_status_history" ALTER COLUMN "changed_at" SET DEFAULT clock_timestamp();