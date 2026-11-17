CREATE TABLE "np_sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"phase" text DEFAULT 'idle' NOT NULL,
	"page" integer DEFAULT 1 NOT NULL,
	"run_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"cities_count" integer DEFAULT 0 NOT NULL,
	"warehouses_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_sync_state_phase_ok" CHECK ("np_sync_state"."phase" in ('idle', 'cities', 'warehouses'))
);
--> statement-breakpoint
ALTER TABLE "np_sync_state" ENABLE ROW LEVEL SECURITY;