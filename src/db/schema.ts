import { pgTable, uuid, text, timestamp, numeric, uniqueIndex, index, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    // NULL means "this line has no billable price any more" — a version like any other,
    // appended when a cost we still incur stops being rebilled (the cold-email infrastructure
    // lines, whose spend moved onto our own fixed costs). It is deliberately NOT zero: zero
    // asserts the work is free, which is false. A null-priced newest version delists the name
    // from the current billable catalog (`/v1/platform-prices`, `/v1/providers-costs`) while
    // every by-name read still resolves it, so spend already declared stays readable.
    costPerUnitInUsdCents: numeric("cost_per_unit_in_usd_cents", { precision: 18, scale: 10 }),
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

/**
 * What one unit of a `providers_costs` price version REALLY cost us from the vendor, before our
 * markup — one row per price version, written once and never updated (see src/lib/vendor-cost.ts).
 *
 * A SEPARATE table rather than a column on `providers_costs` on purpose: every `/v1/providers-costs`
 * read serializes the whole catalog row and those routes require no api key, so a column there
 * would leak our margin. This table is read ONLY by the api-key-gated `/internal/vendor-costs`.
 *
 * NULL vendor cost = not stated, and `unknown_reason` says why. Never zero, never the billed price.
 */
export const providerCostVendorCosts = pgTable(
  "provider_cost_vendor_costs",
  {
    providerCostId: uuid("provider_cost_id").primaryKey(),
    vendorCostPerUnitInUsdCents: numeric("vendor_cost_per_unit_in_usd_cents", { precision: 18, scale: 10 }),
    // billed ÷ vendor for this version (e.g. 5.0000, 1.0000 for pass-through, 4.7170 for a
    // DeepSeek row billed 5x on the VAT-exclusive list price). NULL when the vendor cost is unknown.
    markupMultiplier: numeric("markup_multiplier", { precision: 10, scale: 4 }),
    derivation: text("derivation").notNull(),
    unknownReason: text("unknown_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Named explicitly: drizzle's generated name is 66 characters, Postgres truncates it to 63,
    // and the CI drift check (`drizzle-kit push`) then sees a constraint to recreate forever.
    foreignKey({
      name: "provider_cost_vendor_costs_provider_cost_fk",
      columns: [table.providerCostId],
      foreignColumns: [providersCosts.id],
    }).onDelete("cascade"),
    check(
      "provider_cost_vendor_costs_known_xor_reason",
      sql`(${table.vendorCostPerUnitInUsdCents} IS NULL) = (${table.unknownReason} IS NOT NULL)`,
    ),
  ]
);

export type ProviderCostVendorCost = typeof providerCostVendorCosts.$inferSelect;

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
