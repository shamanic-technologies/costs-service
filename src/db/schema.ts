import { pgTable, uuid, text, timestamp, numeric, uniqueIndex, index, check, foreignKey, date, integer, bigint, jsonb, primaryKey } from "drizzle-orm/pg-core";
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


// --- Price of one cold email sent to a lead (staff display only, see src/lib/email-send-price.ts) ---

/** One refresh attempt. The served series is always the last SUCCEEDED one; a failure is recorded, never zeroes it. */
export const emailSendPriceRefreshes = pgTable(
  "email_send_price_refreshes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asOf: date("as_of").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_email_send_price_refreshes_started").on(table.startedAt),
    check("email_send_price_refreshes_status", sql`${table.status} IN ('running', 'succeeded', 'failed')`),
  ],
);

/** Bronze: the raw upstream bodies, one per (day read, source). A same-day re-read replaces its own row. */
export const emailSendPriceRawReads = pgTable(
  "email_send_price_raw_reads",
  {
    readOn: date("read_on").notNull(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    body: jsonb("body").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "email_send_price_raw_reads_pk", columns: [table.readOn, table.source] })],
);

/** Silver: what we paid each email-infrastructure vendor per day, in US cents, refunds apart. */
export const emailInfraSpendDaily = pgTable(
  "email_infra_spend_daily",
  {
    day: date("day").notNull(),
    vendor: text("vendor").notNull(),
    paidUsdCents: bigint("paid_usd_cents", { mode: "number" }).notNull(),
    refundedUsdCents: bigint("refunded_usd_cents", { mode: "number" }).notNull(),
    payments: integer("payments").notNull(),
    refunds: integer("refunds").notNull(),
  },
  (table) => [primaryKey({ name: "email_infra_spend_daily_pk", columns: [table.day, table.vendor] })],
);

/** Silver: emails sent to leads per UTC day (instantly-service `outreach` sends). Zero days are not stored. */
export const emailsToLeadsDaily = pgTable("emails_to_leads_daily", {
  day: date("day").primaryKey(),
  toLeads: integer("to_leads").notNull(),
});

/** Gold: the per-day price series, dense from the first fact through the refresh day. */
export const emailSendPriceDaily = pgTable("email_send_price_daily", {
  day: date("day").primaryKey(),
  spendUsdCents: bigint("spend_usd_cents", { mode: "number" }).notNull(),
  emailsToLeads: integer("emails_to_leads").notNull(),
  cumulativeSpendUsdCents: bigint("cumulative_spend_usd_cents", { mode: "number" }).notNull(),
  cumulativeEmailsToLeads: integer("cumulative_emails_to_leads").notNull(),
  // Spend columns are NET (paid - refunded). NULL price = no email sent yet (since inception / this
  // month) or a negative net spend: neither is a price.
  priceUsdCents: numeric("price_usd_cents", { precision: 14, scale: 4 }),
  // Gross: every payment, refunds ignored, carried beside the net figures above.
  cumulativePaidUsdCents: bigint("cumulative_paid_usd_cents", { mode: "number" }).notNull(),
  grossPriceUsdCents: numeric("gross_price_usd_cents", { precision: 14, scale: 4 }),
  monthToDateSpendUsdCents: bigint("month_to_date_spend_usd_cents", { mode: "number" }).notNull(),
  monthToDateEmailsToLeads: integer("month_to_date_emails_to_leads").notNull(),
  monthPriceUsdCents: numeric("month_price_usd_cents", { precision: 14, scale: 4 }),
  refreshId: uuid("refresh_id").notNull(),
});

// --- Real cost per credit of each vendor subscription (staff display only, see src/lib/subscription-cost.ts) ---

/** One refresh attempt. The served series is always the last SUCCEEDED one; a failure is recorded, never zeroes it. */
export const subscriptionCostRefreshes = pgTable(
  "subscription_cost_refreshes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asOf: date("as_of").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_subscription_cost_refreshes_started").on(table.startedAt),
    check("subscription_cost_refreshes_status", sql`${table.status} IN ('running', 'succeeded', 'failed')`),
  ],
);

/** Bronze: the raw upstream bodies, one per (day read, source). A same-day re-read replaces its own row. */
export const subscriptionCostRawReads = pgTable(
  "subscription_cost_raw_reads",
  {
    readOn: date("read_on").notNull(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    body: jsonb("body").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "subscription_cost_raw_reads_pk", columns: [table.readOn, table.source] })],
);

/** Silver: what we paid each subscription's ledger vendor per day, in US cents, refunds apart. */
export const subscriptionSpendDaily = pgTable(
  "subscription_spend_daily",
  {
    day: date("day").notNull(),
    vendor: text("vendor").notNull(),
    paidUsdCents: bigint("paid_usd_cents", { mode: "number" }).notNull(),
    refundedUsdCents: bigint("refunded_usd_cents", { mode: "number" }).notNull(),
    payments: integer("payments").notNull(),
    refunds: integer("refunds").notNull(),
  },
  (table) => [primaryKey({ name: "subscription_spend_daily_pk", columns: [table.day, table.vendor] })],
);

/** Silver: units consumed per UTC day, cost name and key source (runs-service), in micro-units. */
export const subscriptionConsumptionDaily = pgTable(
  "subscription_consumption_daily",
  {
    day: date("day").notNull(),
    costName: text("cost_name").notNull(),
    costSource: text("cost_source").notNull(),
    quantityMicros: bigint("quantity_micros", { mode: "number" }).notNull(),
    refundedQuantityMicros: bigint("refunded_quantity_micros", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ name: "subscription_consumption_daily_pk", columns: [table.day, table.costName, table.costSource] }),
  ],
);

/** Gold: per subscription, one point per day since 2026-01-01. Money NULL = no ledger line (unknown, not zero). */
export const subscriptionCostDaily = pgTable(
  "subscription_cost_daily",
  {
    day: date("day").notNull(),
    subscription: text("subscription").notNull(),
    paidUsdCents: bigint("paid_usd_cents", { mode: "number" }),
    refundedUsdCents: bigint("refunded_usd_cents", { mode: "number" }),
    netUsdCents: bigint("net_usd_cents", { mode: "number" }),
    creditsMicros: bigint("credits_micros", { mode: "number" }).notNull(),
    cumulativePaidUsdCents: bigint("cumulative_paid_usd_cents", { mode: "number" }),
    cumulativeRefundedUsdCents: bigint("cumulative_refunded_usd_cents", { mode: "number" }),
    cumulativeNetUsdCents: bigint("cumulative_net_usd_cents", { mode: "number" }),
    cumulativeCreditsMicros: bigint("cumulative_credits_micros", { mode: "number" }).notNull(),
    costPerCreditUsdCents: numeric("cost_per_credit_usd_cents", { precision: 18, scale: 6 }),
    grossCostPerCreditUsdCents: numeric("gross_cost_per_credit_usd_cents", { precision: 18, scale: 6 }),
    refreshId: uuid("refresh_id").notNull(),
  },
  (table) => [primaryKey({ name: "subscription_cost_daily_pk", columns: [table.day, table.subscription] })],
);

// --- Real cost per unit of every cost item + proposed price list (staff display only, see src/lib/real-cost.ts) ---

/** One refresh attempt; records which email-send-price and subscription-cost runs it read. */
export const realCostRefreshes = pgTable(
  "real_cost_refreshes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asOf: date("as_of").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    emailSendPriceRefreshId: uuid("email_send_price_refresh_id"),
    subscriptionCostRefreshId: uuid("subscription_cost_refresh_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_real_cost_refreshes_started").on(table.startedAt),
    check("real_cost_refreshes_status", sql`${table.status} IN ('running', 'succeeded', 'failed')`),
  ],
);

/** Bronze: raw upstream bodies, one per (day read, source); pruned after 30 days (silver is rewritten whole daily). */
export const realCostRawReads = pgTable(
  "real_cost_raw_reads",
  {
    readOn: date("read_on").notNull(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    body: jsonb("body").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "real_cost_raw_reads_pk", columns: [table.readOn, table.source] })],
);

/** Silver: what we paid each declared pay-as-you-go ledger vendor per day, US cents, refunds apart. */
export const paygVendorSpendDaily = pgTable(
  "payg_vendor_spend_daily",
  {
    day: date("day").notNull(),
    vendor: text("vendor").notNull(),
    provider: text("provider").notNull(),
    paidUsdCents: bigint("paid_usd_cents", { mode: "number" }).notNull(),
    refundedUsdCents: bigint("refunded_usd_cents", { mode: "number" }).notNull(),
    payments: integer("payments").notNull(),
    refunds: integer("refunds").notNull(),
  },
  (table) => [primaryKey({ name: "payg_vendor_spend_daily_pk", columns: [table.day, table.vendor] })],
);

/**
 * Silver: a pay-as-you-go vendor's money SPLIT by what it paid for, per day, as the vendor itself
 * reports it (Twilio usage records): `metered` (the ratio's numerator), `rental` (a subscription),
 * `other`, and on the refresh day the `unconsumed-balance` left prepaid. US cents.
 */
export const paygVendorPartsDaily = pgTable(
  "payg_vendor_parts_daily",
  {
    day: date("day").notNull(),
    provider: text("provider").notNull(),
    part: text("part").notNull(),
    usdCents: numeric("usd_cents", { precision: 24, scale: 10 }).notNull(),
    basis: text("basis").notNull(),
  },
  (table) => [primaryKey({ name: "payg_vendor_parts_daily_pk", columns: [table.day, table.provider, table.part] })],
);

/** Silver: units consumed and money billed per day, org, cost name and key source (runs-service, since inception). */
export const consumptionByOrgDaily = pgTable(
  "consumption_by_org_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull(),
    orgId: text("org_id"),
    costName: text("cost_name").notNull(),
    costSource: text("cost_source").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
    billedUsdCents: numeric("billed_usd_cents", { precision: 24, scale: 10 }).notNull(),
    netBilledUsdCents: numeric("net_billed_usd_cents", { precision: 24, scale: 10 }).notNull(),
  },
  (table) => [index("idx_consumption_by_org_daily_org").on(table.orgId)],
);

/** Silver: the same per brand. A co-branded run counts under EACH brand: never summed into an org or fleet figure. */
export const consumptionByBrandDaily = pgTable(
  "consumption_by_brand_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull(),
    orgId: text("org_id"),
    brandId: text("brand_id"),
    costName: text("cost_name").notNull(),
    costSource: text("cost_source").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
    billedUsdCents: numeric("billed_usd_cents", { precision: 24, scale: 10 }).notNull(),
    netBilledUsdCents: numeric("net_billed_usd_cents", { precision: 24, scale: 10 }).notNull(),
  },
  (table) => [index("idx_consumption_by_brand_daily_org_brand").on(table.orgId, table.brandId)],
);

/** Gold: per declared pay-as-you-go provider and day, the ratio real / catalogue vendor cost. */
export const paygRatioDaily = pgTable(
  "payg_ratio_daily",
  {
    day: date("day").notNull(),
    provider: text("provider").notNull(),
    cumulativeNetPaidUsdCents: bigint("cumulative_net_paid_usd_cents", { mode: "number" }).notNull(),
    /** The ratio's numerator: metered spend (= net paid unless the vendor's money is split, `numeratorBasis`). */
    cumulativeMeteredUsdCents: numeric("cumulative_metered_usd_cents", { precision: 24, scale: 10 }).notNull().default("0"),
    numeratorBasis: text("numerator_basis").notNull().default("ledger-net-paid"),
    cumulativeVendorRecordedUsdCents: numeric("cumulative_vendor_recorded_usd_cents", { precision: 24, scale: 10 }).notNull(),
    ratio: numeric("ratio", { precision: 18, scale: 10 }),
  },
  (table) => [primaryKey({ name: "payg_ratio_daily_pk", columns: [table.day, table.provider] })],
);

/** Gold: per cost item and day since 2026-01-01, its real cost per unit and its proposed price. */
export const realUnitCostsDaily = pgTable(
  "real_unit_costs_daily",
  {
    day: date("day").notNull(),
    costName: text("cost_name").notNull(),
    provider: text("provider"),
    method: text("method").notNull(),
    flag: text("flag"),
    realCostUsdCents: numeric("real_cost_usd_cents", { precision: 18, scale: 10 }),
    ratio: numeric("ratio", { precision: 18, scale: 10 }),
    catalogueVendorCostUsdCents: numeric("catalogue_vendor_cost_usd_cents", { precision: 18, scale: 10 }),
    cataloguePriceUsdCents: numeric("catalogue_price_usd_cents", { precision: 18, scale: 10 }),
    multiplier: numeric("multiplier", { precision: 6, scale: 2 }).notNull(),
    proposedPriceUsdCents: numeric("proposed_price_usd_cents", { precision: 18, scale: 10 }),
    proposedBasis: text("proposed_basis").notNull(),
    refreshId: uuid("refresh_id").notNull(),
  },
  (table) => [primaryKey({ name: "real_unit_costs_daily_pk", columns: [table.day, table.costName] })],
);
