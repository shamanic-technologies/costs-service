// Note: db/drizzle imports kept for test compatibility; seed functions
// use raw postgres.js (sql.begin) to bypass drizzle-orm/pgbouncer issues.

const USD_CENTS_DECIMAL_SCALE = 10;

/**
 * DEFAULT cost-risk markup, applied to EVERY seed cost (2× everywhere). The helper
 * still accepts a per-cost override, but no cost currently uses one — all rows fall
 * back to this default.
 */
export const COST_RISK_MULTIPLIER = 2;

// The multiplier is scaled to this many decimals so non-integer markups (e.g. 1.2)
// are computed with exact BigInt math instead of lossy float multiplication.
const MULTIPLIER_DECIMAL_SCALE = 4;

/**
 * Apply a per-cost risk markup to a raw unit cost.
 * @param costPerUnitInUsdCents raw cost as a fixed 10-decimal string (e.g. "2.3600000000")
 * @param multiplier markup factor; defaults to COST_RISK_MULTIPLIER (2). Per-cost overrides
 *   allowed (e.g. 1.2). Result is rounded half-up to 10 decimals.
 */
export function applyCostRiskMultiplier(
  costPerUnitInUsdCents: string,
  multiplier: number = COST_RISK_MULTIPLIER,
): string {
  if (!/^\d+\.\d{10}$/.test(costPerUnitInUsdCents)) {
    throw new Error(`Invalid seed cost format: ${costPerUnitInUsdCents}`);
  }
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error(`Invalid cost-risk multiplier: ${multiplier}`);
  }

  const [wholePart, fractionalPart] = costPerUnitInUsdCents.split(".");
  const scaledCost = BigInt(`${wholePart}${fractionalPart}`); // cost × 10^10

  // Multiplier as an integer scaled by 10^MULTIPLIER_DECIMAL_SCALE, then divided back
  // out with round-half-up so 1.2 stays exact to 10 decimals (default 2 is unchanged).
  const multScaled = BigInt(Math.round(multiplier * 10 ** MULTIPLIER_DECIMAL_SCALE));
  const multDivisor = 10n ** BigInt(MULTIPLIER_DECIMAL_SCALE);
  const marked = (scaledCost * multScaled + multDivisor / 2n) / multDivisor; // cost × multiplier × 10^10

  const divisor = 10n ** BigInt(USD_CENTS_DECIMAL_SCALE);
  const whole = marked / divisor;
  const fractional = (marked % divisor).toString().padStart(USD_CENTS_DECIMAL_SCALE, "0");

  return `${whole}.${fractional}`;
}

// Domain mapping per provider (used by logo.dev on the public pricing page).
export const PROVIDER_DOMAINS: Record<string, string> = {
  apollo: "apollo.io",
  apify: "apify.com",
  anthropic: "anthropic.com",
  cloudflare: "cloudflare.com",
  featured: "featured.com",
  firecrawl: "firecrawl.dev",
  google: "google.com",
  instantly: "instantly.ai",
  postmark: "postmarkapp.com",
  "scrape-do": "scrape.do",
  "serper-dev": "serper.dev",
  stripe: "stripe.com",
  twilio: "twilio.com",
};

export const SEED_PROVIDERS_COSTS = [
  // Apollo — unified credit: Basic plan $59/mo ÷ 2,500 credits = 2.36¢/credit
  // Covers enrichment + person match. Quantity comes from Apollo webhook (credits_consumed).
  // Search is free (0 credits) and not tracked.
  {
    name: "apollo-credit",
    provider: "apollo",
    providerDomain: PROVIDER_DOMAINS.apollo,
    type: "Credit",
    unit: "credit",
    planTier: "basic",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("2.3600000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Apify — pro100chok/ahrefs-seo-tools (actor pC8gsptNv2RwJm0QE)
  // PAY_PER_EVENT: $0.005/result (BRONZE, plan STARTER). 1 result = 1 searchType × 1 domaine.
  // Prix uniforme DR / traffic / AI-citation → un seul "result".
  // https://apify.com/pro100chok/ahrefs-seo-tools
  {
    name: "apify-ahrefs-result",
    provider: "apify",
    providerDomain: PROVIDER_DOMAINS.apify,
    type: "Ahrefs scrape result",
    unit: "result",
    planTier: "starter",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.5000000000"), // $0.005 = 0.5¢
    effectiveFrom: new Date("2026-06-03T00:00:00Z"),
  },
  // Apify — verified B2B email lead actors (apify-service, per-actor cost).
  // PAY_PER_RESULT, plan STARTER (Bronze tier). 1 result = 1 verified lead.
  {
    name: "apify-pipelinelabs-lead",
    provider: "apify",
    providerDomain: PROVIDER_DOMAINS.apify,
    type: "PipelineLabs lead",
    unit: "lead",
    planTier: "starter",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.1000000000"), // $0.001 = 0.1¢
    effectiveFrom: new Date("2026-06-12T00:00:00Z"),
  },
  {
    name: "apify-microworlds-lead",
    provider: "apify",
    providerDomain: PROVIDER_DOMAINS.apify,
    type: "MicroWorlds lead",
    unit: "lead",
    planTier: "starter",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.1600000000"), // $0.0016 = 0.16¢
    effectiveFrom: new Date("2026-06-12T00:00:00Z"),
  },
  {
    name: "apify-clearpath-lead",
    provider: "apify",
    providerDomain: PROVIDER_DOMAINS.apify,
    type: "ClearPath lead",
    unit: "lead",
    planTier: "starter",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("1.5000000000"), // $0.015 = 1.5¢
    effectiveFrom: new Date("2026-06-12T00:00:00Z"),
  },
  // PAY_PER_EVENT actor-start fee, billed once per pipelinelabs actor run (separate from
  // the per-lead event above). apify-service declares both per run.
  {
    name: "apify-pipelinelabs-actor-start",
    provider: "apify",
    providerDomain: PROVIDER_DOMAINS.apify,
    type: "PipelineLabs actor start",
    unit: "run",
    planTier: "starter",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0010000000"), // $0.00001 = 0.001¢ → 0.002¢
    effectiveFrom: new Date("2026-06-12T00:00:00Z"),
  },
  // Apify — email VERIFICATION actor (bounceverify/bounceverify-email-verifier,
  // apify-service POST /verify). Real SMTP + catch-all on bounceverify's own backend
  // (chosen over ryanclinton: benched 5.6× cheaper AND does real SMTP, which Apify-infra
  // actors can't — port 25 is blocked). Single PAY_PER_EVENT per-email fee, no actor-start,
  // charges only decisive results. https://apify.com/bounceverify/bounceverify-email-verifier
  {
    name: "apify-bounceverify-email",
    provider: "apify",
    providerDomain: PROVIDER_DOMAINS.apify,
    type: "BounceVerify email",
    unit: "email",
    planTier: "starter",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0890000000"), // $0.00089 = 0.089¢ → 0.178¢
    effectiveFrom: new Date("2026-06-23T00:00:00Z"),
  },
  // Anthropic Opus 4.5: $5/MTok input, $25/MTok output
  // https://platform.claude.com/docs/en/about-claude/pricing
  {
    name: "anthropic-opus-4.5-tokens-input",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Input tokens (Opus 4.5)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0005000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-opus-4.5-tokens-output",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Output tokens (Opus 4.5)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0025000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Sonnet 4.5: $3/MTok input, $15/MTok output
  {
    name: "anthropic-sonnet-4.5-tokens-input",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Input tokens (Sonnet 4.5)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0003000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-sonnet-4.5-tokens-output",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Output tokens (Sonnet 4.5)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0015000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Sonnet 4.6: $3/MTok input, $15/MTok output (same as 4.5)
  // https://platform.claude.com/docs/en/about-claude/pricing
  {
    name: "anthropic-sonnet-4.6-tokens-input",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Input tokens (Sonnet 4.6)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0003000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-sonnet-4.6-tokens-output",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Output tokens (Sonnet 4.6)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0015000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Opus 4.6: $5/MTok input, $25/MTok output (same as 4.5)
  // https://platform.claude.com/docs/en/about-claude/pricing
  {
    name: "anthropic-opus-4.6-tokens-input",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Input tokens (Opus 4.6)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0005000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-opus-4.6-tokens-output",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Output tokens (Opus 4.6)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0025000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic Haiku 4.5: $1/MTok input, $5/MTok output
  {
    name: "anthropic-haiku-4.5-tokens-input",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Input tokens (Haiku 4.5)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0001000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "anthropic-haiku-4.5-tokens-output",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Output tokens (Haiku 4.5)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0005000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Anthropic — server-side web search tool: $10/1,000 searches = 1.0¢/search
  // Billed per usage.server_tool_use.web_search_requests; one /complete call can trigger multiple searches
  // https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
  {
    name: "anthropic-web-search",
    provider: "anthropic",
    providerDomain: PROVIDER_DOMAINS.anthropic,
    type: "Web search",
    unit: "search",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("1.0000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Featured.com — one pitch submit = 1 credit.
  // We hold the $99/mo Pro/Business sub (unlimited) in practice, but rebill the client at
  // a $1 base unit rate. Opportunity fetches are free/unlimited and are not tracked as
  // billable costs.
  {
    name: "featured-api-pitch-submit",
    provider: "featured",
    providerDomain: PROVIDER_DOMAINS.featured,
    type: "API call (pitch submit)",
    unit: "call",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("100.0000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Postmark — unit cost = plan price ÷ 10,000 emails (10k volume tier)
  // https://postmarkapp.com/pricing
  // Basic 10k tier: $15/mo ÷ 10k = 0.15¢/email
  {
    name: "postmark-email-send",
    provider: "postmark",
    providerDomain: PROVIDER_DOMAINS.postmark,
    type: "Email send",
    unit: "email",
    planTier: "basic-10k",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.1500000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Pro 10k tier: $16.50/mo ÷ 10k = 0.165¢/email
  {
    name: "postmark-email-send",
    provider: "postmark",
    providerDomain: PROVIDER_DOMAINS.postmark,
    type: "Email send",
    unit: "email",
    planTier: "pro-10k",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.1650000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Platform 10k tier: $18/mo ÷ 10k = 0.18¢/email
  {
    name: "postmark-email-send",
    provider: "postmark",
    providerDomain: PROVIDER_DOMAINS.postmark,
    type: "Email send",
    unit: "email",
    planTier: "platform-10k",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.1800000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Firecrawl — scrape: 1 credit per page
  // Hobby plan $16/mo ÷ 3k credits = 0.5333¢/credit
  // https://www.firecrawl.dev/pricing
  {
    name: "firecrawl-scrape-credit",
    provider: "firecrawl",
    providerDomain: PROVIDER_DOMAINS.firecrawl,
    type: "Scrape credit",
    unit: "credit",
    planTier: "hobby",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.6333333333"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Firecrawl — map: 1 credit per page
  {
    name: "firecrawl-map-credit",
    provider: "firecrawl",
    providerDomain: PROVIDER_DOMAINS.firecrawl,
    type: "Map credit",
    unit: "credit",
    planTier: "hobby",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.6333333333"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Firecrawl — extract: token-based billing (1 credit = 15 tokens)
  // Hobby plan $19/mo ÷ 3k credits = 0.6333¢/credit ÷ 15 tokens = 0.0422¢/token
  // https://docs.firecrawl.dev/features/extract
  {
    name: "firecrawl-extract-token",
    provider: "firecrawl",
    providerDomain: PROVIDER_DOMAINS.firecrawl,
    type: "Extract token",
    unit: "token",
    planTier: "hobby",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0422222222"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3 Flash (Preview): $0.50/MTok input, $3.00/MTok output
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-3-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 3 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000500000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-3-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 3 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0003000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3.5 Flash: $1.50/MTok input, $9.00/MTok output (standard pay-as-you-go tier).
  // Internal alias "flash-pro" routes here (price between Flash 3 and Pro 3.1). Launched 2026-05-19.
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-3.5-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 3.5 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0001500000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-3.5-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 3.5 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0009000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3.1 Flash Image: $0.50/MTok input, $60.00/MTok image output.
  // brand-service persona avatars provision 747 image output tokens for 512x512 generation.
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-image-3.1-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 3.1 Flash Image)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000500000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-image-3.1-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Image output tokens (Gemini 3.1 Flash Image)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0060000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3.1 Flash Lite (Preview): $0.25/MTok input, $1.50/MTok output
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-lite-3.1-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 3.1 Flash Lite)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000250000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-lite-3.1-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 3.1 Flash Lite)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0001500000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3.1 Pro (Preview): $2.00/MTok input, $12.00/MTok output (≤200k context)
  // >200k context: $4.00/MTok input, $18.00/MTok output — tracked at standard tier
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-pro-3.1-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 3.1 Pro)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0002000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-pro-3.1-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 3.1 Pro)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0012000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 2.5 Pro: $1.25/MTok input, $10.00/MTok output (≤200k context)
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-pro-2.5-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 2.5 Pro)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0001250000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-pro-2.5-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 2.5 Pro)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0010000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 2.5 Flash: $0.30/MTok input, $2.50/MTok output
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-2.5-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 2.5 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000300000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-2.5-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 2.5 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0002500000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 2.5 Flash-Lite: $0.10/MTok input, $0.40/MTok output
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-lite-2.5-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 2.5 Flash-Lite)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000100000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-lite-2.5-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 2.5 Flash-Lite)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000400000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini Embedding 001: $0.15/MTok input (standard tier).
  // Synchronous batchEmbedContents bills at standard tier, NOT the $0.075 Batch API
  // (async 24h jobs). Embeddings bill input only — the vector output is not token-billed.
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-embedding-001-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini Embedding 001)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000150000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google — Google Search grounding: $14/1,000 queries = 1.4¢/query
  // Gemini 3+ bills per search query (not per prompt); one prompt can trigger multiple queries
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-search-query",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Search query (grounding)",
    unit: "query",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("1.4000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly — contact uploaded: Growth plan $47/mo ÷ 1,000 contacts = 4.70¢/contact
  // https://instantly.ai/pricing
  {
    name: "instantly-contact-uploaded",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Contact upload",
    unit: "contact",
    planTier: "growth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("4.7000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly — email sent per account (Mailforge-provisioned infra).
  // Accounts now come from Mailforge: domain $26/yr shared by 2 accounts, account $3/mo = $36/yr.
  // Each account sends 20 emails/business-day × 252 days = 5,040 emails/yr.
  // Account fee is amortised over that account's own sends:
  //   $36/yr ÷ 5,040 emails = $0.0071428571 = 0.7142857143¢/email.
  // (Domain fee lives on instantly-domain-email-sent below — the two rows sum to the total.)
  {
    name: "instantly-account-email-sent",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Email send (per account)",
    unit: "email",
    planTier: "growth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.7142857143"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly — email sent per domain (Mailforge-provisioned infra).
  // Domain $26/yr is shared by 2 accounts, so amortised over both accounts' combined sends:
  //   $26/yr ÷ (5,040 emails × 2 accounts) = $0.0025793651 = 0.2579365079¢/email.
  // account + domain = 0.9722222222¢/email total (×2 risk markup applied at store time).
  {
    name: "instantly-domain-email-sent",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Email send (per domain)",
    unit: "email",
    planTier: "growth",
    billingCycle: "yearly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.2579365079"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly Hypergrowth — contact uploaded: $97/mo ÷ 25,000 contacts = 0.388¢/contact
  // https://instantly.ai/pricing
  {
    name: "instantly-contact-uploaded",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Contact upload",
    unit: "contact",
    planTier: "hypergrowth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.3880000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly Hypergrowth — email sent per account: same Mailforge model as Growth.
  // $36/yr account fee ÷ (20 emails/business-day × 252 days = 5,040/yr) = 0.7142857143¢/email.
  // This is the SERVED row (instantly platform cost = hypergrowth/monthly).
  {
    name: "instantly-account-email-sent",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Email send (per account)",
    unit: "email",
    planTier: "hypergrowth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.7142857143"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly Hypergrowth — email sent per domain: same Mailforge model as Growth.
  // $26/yr domain fee ÷ (5,040 emails × 2 accounts) = 0.2579365079¢/email.
  {
    name: "instantly-domain-email-sent",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Email send (per domain)",
    unit: "email",
    planTier: "hypergrowth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.2579365079"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Serper.dev — search query (web, news, batch): $0.001/query = 0.1¢/query
  // All search types billed identically; batch bills per individual query
  // No free tier tracked — we bill from the first call
  // https://serper.dev/pricing
  {
    name: "serper-dev-query",
    provider: "serper-dev",
    providerDomain: PROVIDER_DOMAINS["serper-dev"],
    type: "Search query",
    unit: "query",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.1000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Scrape.do — 1 API credit (quantity varies by request type via scrape.do-request-cost header)
  // Hobby plan $29/mo ÷ 250,000 credits = 0.0116¢/credit
  // Only charged on successful responses (errors/timeouts are free)
  // https://scrape.do/pricing/
  {
    name: "scrape-do-credit",
    provider: "scrape-do",
    providerDomain: PROVIDER_DOMAINS["scrape-do"],
    type: "Scrape credit",
    unit: "credit",
    planTier: "hobby",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0116000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Stripe — pass-through processing fees (charge, refund, dispute, payout failure).
  // stripe-service emits one cost write per Stripe-incurred fee event, with quantity
  // set to the fee in cents (from balance_transaction.fee). Unit price is 1 cent base,
  // doubled to 2¢ by applyCostRiskMultiplier — org is charged 2× the actual Stripe fee,
  // matching the platform-wide cost-risk markup convention.
  // https://stripe.com/pricing
  {
    name: "stripe-processing-fee",
    provider: "stripe",
    providerDomain: PROVIDER_DOMAINS.stripe,
    type: "Charge processing fee",
    unit: "USD cent",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("1.0000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "stripe-refund-fee",
    provider: "stripe",
    providerDomain: PROVIDER_DOMAINS.stripe,
    type: "Refund fee",
    unit: "USD cent",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("1.0000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "stripe-dispute-fee",
    provider: "stripe",
    providerDomain: PROVIDER_DOMAINS.stripe,
    type: "Dispute fee",
    unit: "USD cent",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("1.0000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "stripe-payout-failure-fee",
    provider: "stripe",
    providerDomain: PROVIDER_DOMAINS.stripe,
    type: "Payout failure fee",
    unit: "USD cent",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("1.0000000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Twilio — SMS: 1.33¢ per message segment (pay-as-you-go)
  // A "segment" is a 160-char (GSM-7) or 70-char (Unicode) chunk; one SMS may span multiple segments.
  // https://www.twilio.com/en-us/sms/pricing/us
  {
    name: "twilio-sms-segment",
    provider: "twilio",
    providerDomain: PROVIDER_DOMAINS.twilio,
    type: "SMS message",
    unit: "segment",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("1.3300000000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Cloudflare R2 — Class A operations (PUT, POST, COPY, LIST): $4.50 per million ops
  // Covers POST /upload in cloudflare-service (1 PUT per call).
  // https://developers.cloudflare.com/r2/pricing/
  {
    name: "cloudflare-r2-class-a-operation",
    provider: "cloudflare",
    providerDomain: PROVIDER_DOMAINS.cloudflare,
    type: "R2 Class A operation",
    unit: "operation",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0004500000"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Cloudflare R2 — Class B operations (GET, HEAD): $0.36 per million ops
  // Covers GET /images/* in cloudflare-service (1 GET per call). Egress is free.
  // https://developers.cloudflare.com/r2/pricing/
  {
    name: "cloudflare-r2-class-b-operation",
    provider: "cloudflare",
    providerDomain: PROVIDER_DOMAINS.cloudflare,
    type: "R2 Class B operation",
    unit: "operation",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000360000"),
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
  // Apify — STARTER plan (Bronze tier). Resolves apify-ahrefs-result price.
  {
    provider: "apify",
    planTier: "starter",
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
    provider: "cloudflare",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "featured",
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
    provider: "google",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "instantly",
    planTier: "hypergrowth",
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
    provider: "scrape-do",
    planTier: "hobby",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "serper-dev",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    provider: "stripe",
    planTier: "pay-as-you-go",
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

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function nullableSqlLiteral(value: string | null | undefined): string {
  return value == null ? "NULL" : `'${escapeSqlLiteral(value)}'`;
}

export async function seedProvidersCosts() {
  // APPEND-ONLY price history — NEVER overwrite a cost. For each seed row we compare its
  // cost to the LATEST existing row for (name, plan_tier, billing_cycle):
  //   - no row yet           → INSERT with the declared effective_from (first version)
  //   - cost differs         → INSERT a NEW row dated now() (the prior row stays as history)
  //   - cost equal           → no-op (idempotent across every boot)
  // A price is thus queryable through time: the read path resolves the newest row whose
  // effective_from <= now(). Do NOT reintroduce `ON CONFLICT ... DO UPDATE cost_per_unit`
  // — that silently destroys history (see CLAUDE.md "Seed = append-only on price change").
  //
  // No DELETE: orphan rows from removed/renamed seed entries persist forever; the API
  // filters by platform plan so they are inert at read time, but any migration adding a
  // NOT NULL/CHECK constraint must handle them (see CLAUDE.md "Migration safety" + 0004).
  //
  // pg_advisory_xact_lock serializes concurrent boots (multi-replica) so two instances
  // that both observe the same price change cannot each append a near-duplicate dated row.
  //
  // The direct (non-pooler) client bypasses pgbouncer transaction mode (which can silently
  // drop multi-statement writes) and is opened/closed inside the function so the Neon
  // compute slot is released after seeding (a module-level direct client leaked one slot
  // per Cloud Run instance and exhausted Neon's permit cap under autoscale).
  const { default: postgres } = await import("postgres");
  const { directConnectionString } = await import("./index.js");
  const directSql = postgres(directConnectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const valuesClause = SEED_PROVIDERS_COSTS.map(
      (c) =>
        `('${escapeSqlLiteral(c.name)}', '${escapeSqlLiteral(c.provider)}', ${nullableSqlLiteral(c.providerDomain)}, '${escapeSqlLiteral(c.type)}', '${escapeSqlLiteral(c.unit)}', '${escapeSqlLiteral(c.planTier)}', '${escapeSqlLiteral(c.billingCycle)}', ${c.costPerUnitInUsdCents}, '${c.effectiveFrom.toISOString()}'::timestamptz)`
    ).join(", ");

    await directSql.begin(async (tx) => {
      await tx.unsafe(`SELECT pg_advisory_xact_lock(911001)`);
      await tx.unsafe(`
        INSERT INTO providers_costs (name, provider, provider_domain, type, unit, plan_tier, billing_cycle, cost_per_unit_in_usd_cents, effective_from)
        SELECT v.name, v.provider, v.provider_domain, v.type, v.unit, v.plan_tier, v.billing_cycle, v.cost,
               CASE WHEN latest.effective_from IS NULL THEN v.declared_eff ELSE now() END
        FROM (VALUES ${valuesClause}) AS v (name, provider, provider_domain, type, unit, plan_tier, billing_cycle, cost, declared_eff)
        LEFT JOIN LATERAL (
          SELECT pc.cost_per_unit_in_usd_cents AS cost, pc.effective_from
          FROM providers_costs pc
          WHERE pc.name = v.name AND pc.plan_tier = v.plan_tier AND pc.billing_cycle = v.billing_cycle
          ORDER BY pc.effective_from DESC
          LIMIT 1
        ) latest ON TRUE
        WHERE latest.cost IS DISTINCT FROM v.cost
      `);
    });

    const [{ count }] = await directSql.unsafe(`SELECT count(*)::int as count FROM providers_costs`);
    if (count < SEED_PROVIDERS_COSTS.length) {
      throw new Error(
        `[Costs Service] Seed verify failed: expected at least ${SEED_PROVIDERS_COSTS.length} rows, found ${count}. Aborting startup.`
      );
    }
    console.log(`[Costs Service] Seed complete (${count} provider cost row(s); append-only history)`);
  } finally {
    await directSql.end({ timeout: 5 });
  }
}

export async function seedPlatformCosts() {
  const { default: postgres } = await import("postgres");
  const { directConnectionString } = await import("./index.js");
  const directSql = postgres(directConnectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const valuesClause = SEED_PLATFORM_COSTS.map(
      (c) => `('${escapeSqlLiteral(c.provider)}', '${escapeSqlLiteral(c.planTier)}', '${escapeSqlLiteral(c.billingCycle)}', '${c.effectiveFrom.toISOString()}'::timestamptz)`
    ).join(", ");

    // APPEND-ONLY history (same contract as seedProvidersCosts): compare (plan_tier,
    // billing_cycle) to the LATEST platform row for the provider; INSERT a new dated row
    // when it differs, no-op when equal. Never overwrite — a tier switch must be queryable
    // through time. getCurrentPlatformCost resolves the newest row whose effective_from <= now().
    await directSql.begin(async (tx) => {
      await tx.unsafe(`SELECT pg_advisory_xact_lock(911002)`);
      await tx.unsafe(`
        INSERT INTO platform_costs (provider, plan_tier, billing_cycle, effective_from)
        SELECT v.provider, v.plan_tier, v.billing_cycle,
               CASE WHEN latest.effective_from IS NULL THEN v.declared_eff ELSE now() END
        FROM (VALUES ${valuesClause}) AS v (provider, plan_tier, billing_cycle, declared_eff)
        LEFT JOIN LATERAL (
          SELECT pc.plan_tier, pc.billing_cycle, pc.effective_from
          FROM platform_costs pc
          WHERE pc.provider = v.provider
          ORDER BY pc.effective_from DESC
          LIMIT 1
        ) latest ON TRUE
        WHERE (latest.plan_tier, latest.billing_cycle) IS DISTINCT FROM (v.plan_tier, v.billing_cycle)
      `);
    });

    const [{ count }] = await directSql.unsafe(`SELECT count(*)::int as count FROM platform_costs`);
    if (count < SEED_PLATFORM_COSTS.length) {
      throw new Error(
        `[Costs Service] Platform seed verify failed: expected at least ${SEED_PLATFORM_COSTS.length} rows, found ${count}. Aborting startup.`
      );
    }
    console.log(`[Costs Service] Platform seed complete (${count} platform cost row(s); append-only history)`);
  } finally {
    await directSql.end({ timeout: 5 });
  }
}
