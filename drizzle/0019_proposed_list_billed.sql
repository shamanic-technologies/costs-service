CREATE TABLE IF NOT EXISTS "catalogue_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"real_cost_refresh_id" uuid,
	"proposed_list_day" date,
	"status" text NOT NULL,
	"error" text,
	"versions_written" integer DEFAULT 0 NOT NULL,
	"kept" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "catalogue_syncs_status" CHECK ("catalogue_syncs"."status" IN ('succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "providers_costs" ADD COLUMN "price_source" text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_catalogue_syncs_started" ON "catalogue_syncs" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "providers_costs" ADD CONSTRAINT "providers_costs_price_source" CHECK ("providers_costs"."price_source" IN ('seed', 'api', 'proposed-list'));