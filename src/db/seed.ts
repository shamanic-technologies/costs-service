import { db } from "./index.js";
import { providersCosts, platformCosts } from "./schema.js";

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
  // Postmark — Basic plan: $1.80/1k overage = 0.18¢/email
  // https://postmarkapp.com/pricing
  {
    name: "postmark-email-send",
    provider: "postmark",
    planTier: "basic",
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
    planTier: "basic",
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
      .onConflictDoNothing();
  }
  console.log(`[Costs Service] Seed complete (${SEED_PROVIDERS_COSTS.length} provider cost(s) checked)`);
}

export async function seedPlatformCosts() {
  for (const cost of SEED_PLATFORM_COSTS) {
    await db
      .insert(platformCosts)
      .values(cost)
      .onConflictDoNothing();
  }
  console.log(`[Costs Service] Platform costs seed complete (${SEED_PLATFORM_COSTS.length} platform cost(s) checked)`);
}
