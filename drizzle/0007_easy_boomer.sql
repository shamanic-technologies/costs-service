-- Adds providers_costs.pricing_basis: 'marked-up' | 'pass-through'.
--
-- Three statements, not one: `ADD COLUMN ... NOT NULL` with no default fails outright on a
-- non-empty table, and every production row (including the orphans the append-only seed never
-- deletes) pre-dates the column. Backfill them to 'marked-up' first — that is the truth, not a
-- convenience: until this migration, every seed value went through applyCostRiskMultiplier.
ALTER TABLE "providers_costs" ADD COLUMN "pricing_basis" text;--> statement-breakpoint
UPDATE "providers_costs" SET "pricing_basis" = 'marked-up' WHERE "pricing_basis" IS NULL;--> statement-breakpoint
ALTER TABLE "providers_costs" ALTER COLUMN "pricing_basis" SET NOT NULL;
