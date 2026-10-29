ALTER TABLE "providers_costs" ADD COLUMN "standard_price_per_unit_in_usd_cents" numeric(18, 10);--> statement-breakpoint
ALTER TABLE "real_unit_costs_daily" ADD COLUMN "standard_price_usd_cents" numeric(18, 10);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_price_lists" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"price_list" text NOT NULL,
	"org_created_at" timestamp with time zone,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_price_lists_price_list" CHECK ("org_price_lists"."price_list" IN ('standard', 'grandfathered'))
);
