CREATE TYPE "public"."reminder_kind" AS ENUM('client_inactive', 'box_overdue', 'payment_unmatched');--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"client_id" uuid,
	"box_id" uuid,
	"assignee_id" uuid NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_assignee_id_profiles_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_dedupe_key_key" ON "reminders" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "reminders_assignee_due_idx" ON "reminders" USING btree ("assignee_id","due_at");--> statement-breakpoint
CREATE INDEX "reminders_client_id_idx" ON "reminders" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "reminders_box_id_idx" ON "reminders" USING btree ("box_id");