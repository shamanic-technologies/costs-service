ALTER TABLE "cost_units" RENAME TO "providers_costs";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_cost_units_name_plan_effective" RENAME TO "idx_providers_costs_name_plan_effective";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_cost_units_name" RENAME TO "idx_providers_costs_name";--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_cost_units_provider" RENAME TO "idx_providers_costs_provider";
