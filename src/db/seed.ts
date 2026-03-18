// Note: db/drizzle imports kept for test compatibility; seed functions
// use raw postgres.js (sql.begin) to bypass drizzle-orm/pgbouncer issues.

export const SEED_PROVIDERS_COSTS = [
  // Apollo — search is free via API (0 credits consumed)
  // https://docs.apollo.io/reference/people-api-search
  {
    name: "apollo-search-credit",
    provider: "apollo",
    planTier: "basic",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0000000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Apollo — enrichment: 1 credit per person (email reveal)
  // Basic plan $59/mo ÷ 2,500 credits = 2.36¢/credit
  // https://docs.apollo.io/reference/people-enrichment
  {
    name: "apollo-enrichment-credit",
    provider: "apollo",
    planTier: "basic",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "2.3600000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Apollo — person match: 1 credit per match (name + domain → email)
  // Same credit type as enrichment: Basic plan $59/mo ÷ 2,500 credits = 2.36¢/credit
  // Only charged when Apollo returns an email
  // https://docs.apollo.io/reference/people-match
  {
    name: "apollo-person-match-credit",
    provider: "apollo",
    planTier: "basic",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "2.3600000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Opus 4.5: $5/MTok input, $25/MTok output
  // https://platform.claude.com/docs/en/about-claude/pricing
  {
    name: "anthropic-opus-4.5-tokens-input",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0005000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-opus-4.5-tokens-output",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0025000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Sonnet 4.5: $3/MTok input, $15/MTok output
  {
    name: "anthropic-sonnet-4.5-tokens-input",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0003000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-sonnet-4.5-tokens-output",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0015000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Sonnet 4.6: $3/MTok input, $15/MTok output (same as 4.5)
  // https://platform.claude.com/docs/en/about-claude/pricing
  {
    name: "anthropic-sonnet-4.6-tokens-input",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0003000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-sonnet-4.6-tokens-output",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0015000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Opus 4.6: $5/MTok input, $25/MTok output (same as 4.5)
  // https://platform.claude.com/docs/en/about-claude/pricing
  {
    name: "anthropic-opus-4-6-input-token",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0005000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-opus-4-6-output-token",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0025000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Haiku 4.5: $1/MTok input, $5/MTok output
  {
    name: "anthropic-haiku-4.5-tokens-input",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0001000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-haiku-4.5-tokens-output",
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0005000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Postmark — unit cost = plan price ÷ 10,000 emails (10k volume tier)
  // https://postmarkapp.com/pricing
  // Basic 10k tier: $15/mo ÷ 10k = 0.15¢/email
  {
    name: "postmark-email-send",
    provider: "postmark",
    planTier: "basic-10k",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.1500000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Pro 10k tier: $16.50/mo ÷ 10k = 0.165¢/email
  {
    name: "postmark-email-send",
    provider: "postmark",
    planTier: "pro-10k",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.1650000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Platform 10k tier: $18/mo ÷ 10k = 0.18¢/email
  {
    name: "postmark-email-send",
    provider: "postmark",
    planTier: "platform-10k",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.1800000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Firecrawl — scrape: 1 credit per page
  // Hobby plan $16/mo ÷ 3k credits = 0.5333¢/credit
  // https://www.firecrawl.dev/pricing
  {
    name: "firecrawl-scrape-credit",
    provider: "firecrawl",
    planTier: "hobby",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.6333333333",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Firecrawl — map: 1 credit per page
  {
    name: "firecrawl-map-credit",
    provider: "firecrawl",
    planTier: "hobby",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.6333333333",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3 Flash (Preview): $0.50/MTok input, $3.00/MTok output
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "gemini-3-flash-tokens-input",
    provider: "gemini",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0000500000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "gemini-3-flash-tokens-output",
    provider: "gemini",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.0003000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini — Google Search grounding: $14/1,000 queries = 1.4¢/query
  // Gemini 3+ bills per search query (not per prompt); one prompt can trigger multiple queries
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "gemini-google-search-query",
    provider: "gemini",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "1.4000000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly — email send: Growth plan $37/mo ÷ 5,000 emails = 0.74¢/email
  // https://instantly.ai/pricing
  {
    name: "instantly-email-send",
    provider: "instantly",
    planTier: "growth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "0.9400000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Twilio — SMS: 1.33¢ per message segment (pay-as-you-go)
  // https://www.twilio.com/en-us/sms/pricing/us
  {
    name: "twilio-sms-segment",
    provider: "twilio",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: "1.3300000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
];

export const SEED_PLATFORM_COSTS = [
  {
    provider: "apollo",
    planTier: "basic",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "anthropic",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "firecrawl",
    planTier: "hobby",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "gemini",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "instantly",
    planTier: "growth",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "postmark",
    planTier: "pro-10k",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "twilio",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
];

export async function seedProvidersCosts() {
  // Uses direct (non-pooler) connection to bypass pgbouncer write issues.
  // UPSERT only — no DELETE. Orphan rows are harmless (API filters by platform plan).
  const { directSql } = await import("./index.js");

  const valuesClause = SEED_PROVIDERS_COSTS.map(
    (c) => `('${c.name}', '${c.provider}', '${c.planTier}', '${c.billingCycle}', ${c.costPerUnitInUsdCents}, '${c.effectiveFrom.toISOString()}'::timestamptz)`
  ).join(", ");

  await directSql.unsafe(`
    INSERT INTO providers_costs (name, provider, plan_tier, billing_cycle, cost_per_unit_in_usd_cents, effective_from)
    VALUES ${valuesClause}
    ON CONFLICT (name, plan_tier, billing_cycle, effective_from)
    DO UPDATE SET
      provider = EXCLUDED.provider,
      cost_per_unit_in_usd_cents = EXCLUDED.cost_per_unit_in_usd_cents,
      updated_at = now()
  `);

  const [{ count }] = await directSql.unsafe(`SELECT count(*)::int as count FROM providers_costs`);
  if (count < SEED_PROVIDERS_COSTS.length) {
    throw new Error(
      `[Costs Service] Seed upsert failed: expected at least ${SEED_PROVIDERS_COSTS.length} rows, found ${count}. Aborting startup.`
    );
  }
  console.log(`[Costs Service] Seed complete (${count} provider cost(s))`);
}

export async function seedPlatformCosts() {
  const { directSql } = await import("./index.js");

  const valuesClause = SEED_PLATFORM_COSTS.map(
    (c) => `('${c.provider}', '${c.planTier}', '${c.billingCycle}', '${c.effectiveFrom.toISOString()}'::timestamptz)`
  ).join(", ");

  await directSql.unsafe(`
    INSERT INTO platform_costs (provider, plan_tier, billing_cycle, effective_from)
    VALUES ${valuesClause}
    ON CONFLICT (provider, effective_from)
    DO UPDATE SET
      plan_tier = EXCLUDED.plan_tier,
      billing_cycle = EXCLUDED.billing_cycle,
      updated_at = now()
  `);

  const [{ count }] = await directSql.unsafe(`SELECT count(*)::int as count FROM platform_costs`);
  if (count < SEED_PLATFORM_COSTS.length) {
    throw new Error(
      `[Costs Service] Platform seed upsert failed: expected at least ${SEED_PLATFORM_COSTS.length} rows, found ${count}. Aborting startup.`
    );
  }
  console.log(`[Costs Service] Platform seed complete (${count} platform cost(s))`);
}
