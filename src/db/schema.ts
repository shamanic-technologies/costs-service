import { pgTable, uuid, text, timestamp, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";

export const providersCosts = pgTable(
  "providers_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    providerDomain: text("provider_domain"),
    type: text("type").notNull(),
    unit: text("unit").notNull(),
    planTier: text("plan_tier").notNull(),
    billingCycle: text("billing_cycle").notNull(),
    costPerUnitInUsdCents: numeric("cost_per_unit_in_usd_cents", { precision: 18, scale: 10 }).notNull(),
    // Time-of-day pricing regime this price point belongs to.
    // NULL  = the provider charges one rate at every hour (the common case).
    // 'peak' / 'off-peak' = the provider charges by time of day (DeepSeek from
    // 2026-08-16T16:00Z); the cost NAME carries the same segment, so a consumer selects the
    // regime by name and never has to compute a rate.
    pricingRegime: text("pricing_regime"),
    // UTC hour windows during which THIS row's regime is the one in force, as a
    // comma-separated list of half-open HH:MM-HH:MM ranges, e.g. "01:00-04:00,06:00-10:00".
    // NULL when pricingRegime is NULL (the price applies at every hour). For a provider that
    // does have regimes, the regimes' windows partition the 24h day, so exactly one cost name
    // matches any given instant.
    regimeHoursUtc: text("regime_hours_utc"),
    // How this row's price relates to what the vendor charges. Two values, no third:
    //   'marked-up'    = work we perform (LLM tokens, embeddings, enrichment, search, creative
    //                    generation). The stored price is the vendor rate × COST_DEFAULT_MULTIPLIER.
    //   'pass-through' = money we merely route (advertising-platform spend, payment-processing
    //                    fees). The stored price IS the vendor rate — no markup, ever.
    // NOT NULL on purpose: a line whose class cannot be resolved must fail loudly rather than
    // default to either side, because the public promise ("no markup on what we route") is only
    // true if every line states its own class. Rows that pre-date the column were all marked up,
    // so migration 0007 backfills them to 'marked-up' before locking the constraint.
    pricingBasis: text("pricing_basis").notNull(),
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

export const platformCosts = pgTable(
  "platform_costs",
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
    uniqueIndex("idx_platform_costs_provider_effective").on(table.provider, table.effectiveFrom),
    index("idx_platform_costs_provider").on(table.provider),
  ]
);

export type PlatformCost = typeof platformCosts.$inferSelect;
export type NewPlatformCost = typeof platformCosts.$inferInsert;
