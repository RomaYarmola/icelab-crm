CREATE TABLE "error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"digest" text,
	"stack" text,
	"path" text,
	"method" text,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "error_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "error_log_last_seen_idx" ON "error_log" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "error_log_fingerprint_idx" ON "error_log" USING btree ("source","path","last_seen_at");