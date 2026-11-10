CREATE TABLE "login_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_failures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "login_failures_email_created_idx" ON "login_failures" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_failures_ip_created_idx" ON "login_failures" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "login_failures_created_idx" ON "login_failures" USING btree ("created_at");