CREATE TABLE IF NOT EXISTS "cost_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cost_per_unit_in_usd_cents" numeric(12, 10) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cost_units_name_effective" ON "cost_units" USING btree ("name","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cost_units_name" ON "cost_units" USING btree ("name");