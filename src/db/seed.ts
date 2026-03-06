import { db } from "./index.js";
import { providersCosts, platformCosts } from "./schema.js";
import { notInArray, and, eq, ne } from "drizzle-orm";

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
  for (const cost of SEED_PROVIDERS_COSTS) {
    await db
      .insert(providersCosts)
      .values(cost)
      .onConflictDoUpdate({
        target: [providersCosts.name, providersCosts.planTier, providersCosts.billingCycle, providersCosts.effectiveFrom],
        set: {
          costPerUnitInUsdCents: cost.costPerUnitInUsdCents,
          provider: cost.provider,
        },
      });
  }

  // Remove stale rows from old seeds (plan_tiers not in seed for known names)
  const validTiersByName = new Map<string, string[]>();
  for (const cost of SEED_PROVIDERS_COSTS) {
    const tiers = validTiersByName.get(cost.name) ?? [];
    if (!tiers.includes(cost.planTier)) tiers.push(cost.planTier);
    validTiersByName.set(cost.name, tiers);
  }
  for (const [name, tiers] of validTiersByName) {
    await db
      .delete(providersCosts)
      .where(and(eq(providersCosts.name, name), notInArray(providersCosts.planTier, tiers)));
  }

  // Remove rows with names not in the seed at all
  const validNames = SEED_PROVIDERS_COSTS.map((c) => c.name);
  const deleted = await db
    .delete(providersCosts)
    .where(notInArray(providersCosts.name, validNames))
    .returning({ name: providersCosts.name });
  if (deleted.length > 0) {
    console.log(`[Costs Service] Removed ${deleted.length} orphaned provider cost(s): ${deleted.map((d) => d.name).join(", ")}`);
  }

  console.log(`[Costs Service] Seed complete (${SEED_PROVIDERS_COSTS.length} provider cost(s) checked)`);
}

export async function seedPlatformCosts() {
  for (const cost of SEED_PLATFORM_COSTS) {
    await db
      .insert(platformCosts)
      .values(cost)
      .onConflictDoUpdate({
        target: [platformCosts.provider, platformCosts.effectiveFrom],
        set: {
          planTier: cost.planTier,
          billingCycle: cost.billingCycle,
        },
      });
  }

  // Remove stale rows from old seeds (wrong plan_tier for known providers)
  const seenProviders = new Set<string>();
  for (const cost of SEED_PLATFORM_COSTS) {
    if (seenProviders.has(cost.provider)) continue;
    seenProviders.add(cost.provider);
    await db
      .delete(platformCosts)
      .where(and(eq(platformCosts.provider, cost.provider), ne(platformCosts.planTier, cost.planTier)));
  }

  // Remove rows with providers not in the seed at all
  const validProviders = SEED_PLATFORM_COSTS.map((c) => c.provider);
  const deleted = await db
    .delete(platformCosts)
    .where(notInArray(platformCosts.provider, validProviders))
    .returning({ provider: platformCosts.provider });
  if (deleted.length > 0) {
    console.log(`[Costs Service] Removed ${deleted.length} orphaned platform cost(s): ${deleted.map((d) => d.provider).join(", ")}`);
  }

  console.log(`[Costs Service] Platform costs seed complete (${SEED_PLATFORM_COSTS.length} platform cost(s) checked)`);
}
