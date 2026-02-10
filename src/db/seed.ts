import { db } from "./index.js";
import { costUnits } from "./schema.js";

export const SEED_COSTS = [
  // Apollo — search is free via API (0 credits consumed)
  // https://docs.apollo.io/reference/people-api-search
  {
    name: "apollo-search-credit",
    costPerUnitInUsdCents: "0.0000000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Apollo — enrichment: 1 credit per person (email reveal)
  // Basic plan ~0.98¢/credit ($49/mo ÷ 5k credits) — worst-case across plans
  // https://docs.apollo.io/reference/people-enrichment
  {
    name: "apollo-enrichment-credit",
    costPerUnitInUsdCents: "0.9800000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Opus 4.5: $5/MTok input, $25/MTok output
  // https://platform.claude.com/docs/en/about-claude/pricing
  {
    name: "anthropic-opus-4.5-tokens-input",
    costPerUnitInUsdCents: "0.0005000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-opus-4.5-tokens-output",
    costPerUnitInUsdCents: "0.0025000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Sonnet 4.5: $3/MTok input, $15/MTok output
  {
    name: "anthropic-sonnet-4.5-tokens-input",
    costPerUnitInUsdCents: "0.0003000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-sonnet-4.5-tokens-output",
    costPerUnitInUsdCents: "0.0015000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Haiku 4.5: $1/MTok input, $5/MTok output
  {
    name: "anthropic-haiku-4.5-tokens-input",
    costPerUnitInUsdCents: "0.0001000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-haiku-4.5-tokens-output",
    costPerUnitInUsdCents: "0.0005000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "postmark-email-send",
    costPerUnitInUsdCents: "0.1800000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Firecrawl — scrape: 1 credit per page
  // Hobby plan $19/mo ÷ 3k credits = 0.6333¢/credit (worst-case paid plan)
  // https://www.firecrawl.dev/pricing
  {
    name: "firecrawl-scrape-credit",
    costPerUnitInUsdCents: "0.6333333333",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Firecrawl — map: 1 credit per page
  {
    name: "firecrawl-map-credit",
    costPerUnitInUsdCents: "0.6333333333",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3 Flash (Preview): $0.50/MTok input, $3.00/MTok output
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "gemini-3-flash-tokens-input",
    costPerUnitInUsdCents: "0.0000500000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "gemini-3-flash-tokens-output",
    costPerUnitInUsdCents: "0.0003000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly — campaign creation: unlimited on all plans = 0
  // https://instantly.ai/pricing
  {
    name: "instantly-campaign-create",
    costPerUnitInUsdCents: "0.0000000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly — email send: Growth plan $47/mo ÷ 5,000 emails = 0.94¢/email
  // https://instantly.ai/pricing
  {
    name: "instantly-email-send",
    costPerUnitInUsdCents: "0.9400000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
];

export async function seedCosts() {
  for (const cost of SEED_COSTS) {
    await db
      .insert(costUnits)
      .values(cost)
      .onConflictDoNothing();
  }
  console.log(`[Costs Service] Seed complete (${SEED_COSTS.length} cost(s) checked)`);
}
