import { pgTable, uuid, text, timestamp, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";

export const providersCosts = pgTable(
  "providers_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    planTier: text("plan_tier").notNull(),
    billingCycle: text("billing_cycle").notNull(),
    costPerUnitInUsdCents: numeric("cost_per_unit_in_usd_cents", { precision: 12, scale: 10 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_providers_costs_name_plan_effective").on(
      table.name,
      table.planTier,
      table.billingCycle,
      table.effectiveFrom,
    ),
    index("idx_providers_costs_name").on(table.name),
    index("idx_providers_costs_provider").on(table.provider),
  ]
);

export type ProviderCost = typeof providersCosts.$inferSelect;
export type NewProviderCost = typeof providersCosts.$inferInsert;

export const platformPlans = pgTable(
  "platform_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    planTier: text("plan_tier").notNull(),
    billingCycle: text("billing_cycle").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_platform_plans_provider_effective").on(table.provider, table.effectiveFrom),
    index("idx_platform_plans_provider").on(table.provider),
  ]
);

export type PlatformPlan = typeof platformPlans.$inferSelect;
export type NewPlatformPlan = typeof platformPlans.$inferInsert;
