CREATE TABLE IF NOT EXISTS "provider_cost_vendor_costs" (
	"provider_cost_id" uuid PRIMARY KEY NOT NULL,
	"vendor_cost_per_unit_in_usd_cents" numeric(18, 10),
	"markup_multiplier" numeric(10, 4),
	"derivation" text NOT NULL,
	"unknown_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_cost_vendor_costs_known_xor_reason" CHECK (("provider_cost_vendor_costs"."vendor_cost_per_unit_in_usd_cents" IS NULL) = ("provider_cost_vendor_costs"."unknown_reason" IS NOT NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_cost_vendor_costs" ADD CONSTRAINT "provider_cost_vendor_costs_provider_cost_fk" FOREIGN KEY ("provider_cost_id") REFERENCES "public"."providers_costs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
