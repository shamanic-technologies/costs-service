ALTER TABLE "platform_plans" RENAME TO "platform_costs";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_platform_plans_provider_effective" RENAME TO "idx_platform_costs_provider_effective";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_platform_plans_provider" RENAME TO "idx_platform_costs_provider";
