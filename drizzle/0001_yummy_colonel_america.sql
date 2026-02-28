CREATE TABLE IF NOT EXISTS "platform_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"plan_tier" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_cost_units_name_effective";--> statement-breakpoint
ALTER TABLE "cost_units" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "cost_units" ADD COLUMN "plan_tier" text;--> statement-breakpoint
ALTER TABLE "cost_units" ADD COLUMN "billing_cycle" text;--> statement-breakpoint
UPDATE "cost_units" SET
  "provider" = CASE
    WHEN "name" LIKE 'apollo-%' THEN 'apollo'
    WHEN "name" LIKE 'anthropic-%' THEN 'anthropic'
    WHEN "name" LIKE 'firecrawl-%' THEN 'firecrawl'
    WHEN "name" LIKE 'gemini-%' THEN 'gemini'
    WHEN "name" LIKE 'instantly-%' THEN 'instantly'
    WHEN "name" LIKE 'postmark-%' THEN 'postmark'
    WHEN "name" LIKE 'twilio-%' THEN 'twilio'
    ELSE split_part("name", '-', 1)
  END,
  "plan_tier" = CASE
    WHEN "name" LIKE 'apollo-%' THEN 'basic'
    WHEN "name" LIKE 'anthropic-%' THEN 'pay-as-you-go'
    WHEN "name" LIKE 'firecrawl-%' THEN 'hobby'
    WHEN "name" LIKE 'gemini-%' THEN 'pay-as-you-go'
    WHEN "name" LIKE 'instantly-%' THEN 'growth'
    WHEN "name" LIKE 'postmark-%' THEN 'basic'
    WHEN "name" LIKE 'twilio-%' THEN 'pay-as-you-go'
    ELSE 'pay-as-you-go'
  END,
  "billing_cycle" = 'monthly'
WHERE "provider" IS NULL;--> statement-breakpoint
ALTER TABLE "cost_units" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_units" ALTER COLUMN "plan_tier" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_units" ALTER COLUMN "billing_cycle" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_platform_plans_provider_effective" ON "platform_plans" USING btree ("provider","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_plans_provider" ON "platform_plans" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cost_units_name_plan_effective" ON "cost_units" USING btree ("name","plan_tier","billing_cycle","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cost_units_provider" ON "cost_units" USING btree ("provider");
