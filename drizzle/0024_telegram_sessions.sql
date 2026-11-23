CREATE TABLE "telegram_sessions" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_sessions" ENABLE ROW LEVEL SECURITY;