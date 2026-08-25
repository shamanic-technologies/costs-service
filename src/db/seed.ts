// Note: db/drizzle imports kept for test compatibility; seed functions
// use raw postgres.js (sql.begin) to bypass drizzle-orm/pgbouncer issues.

const USD_CENTS_DECIMAL_SCALE = 10;

/**
 * Cost-risk markup — covers the risk that the raw provider cost is under-estimated.
 */
export const COST_RISK_MULTIPLIER = 2;

/**
 * Profit markup — stacks multiplicatively on top of the risk markup.
 *
 * Raised 2 → 2.5 (default markup 4× → 5×) when the cold-email infrastructure spend
 * (Instantly subscriptions, MailForge, PrimeForge, the Claude Max seat) moved OFF the
 * per-customer rebill and onto our own fixed costs: the lines we still rebill carry the
 * unit economics that the retired cold-email lines used to. Risk is untouched — nothing
 * changed about how well we estimate a vendor's rate; what changed is the store margin.
 */
export const COST_PROFIT_MULTIPLIER = 2.5;

/**
 * DEFAULT markup applied to EVERY marked-up seed cost: risk × profit (2 × 2.5 = 5× everywhere).
 * The helper still accepts a per-cost override, but no cost currently uses one — all
 * rows fall back to this default.
 */
export const COST_DEFAULT_MULTIPLIER =
  COST_RISK_MULTIPLIER * COST_PROFIT_MULTIPLIER;

// The multiplier is scaled to this many decimals so non-integer markups (e.g. 1.2)
// are computed with exact BigInt math instead of lossy float multiplication.
const MULTIPLIER_DECIMAL_SCALE = 4;

/**
 * Multiply a fixed 10-decimal cost string by a factor, exactly, rounding half-up.
 *
 * Shared by the two places that scale a raw vendor rate — the store markup and the
 * non-recoverable VAT some vendors add on top of their list price. They are different
 * decisions with different justifications, so they are different functions; only the
 * arithmetic is common, and it lives here so neither drifts into lossy float math.
 */
function scaleFixedDecimalCost(
  costPerUnitInUsdCents: string,
  factor: number,
  factorLabel: string,
): string {
  if (!/^\d+\.\d{10}$/.test(costPerUnitInUsdCents)) {
    throw new Error(`Invalid seed cost format: ${costPerUnitInUsdCents}`);
  }
  if (!Number.isFinite(factor) || factor < 0) {
    throw new Error(`Invalid ${factorLabel}: ${factor}`);
  }

  const [wholePart, fractionalPart] = costPerUnitInUsdCents.split(".");
  const scaledCost = BigInt(`${wholePart}${fractionalPart}`); // cost × 10^10

  // Factor as an integer scaled by 10^MULTIPLIER_DECIMAL_SCALE, then divided back
  // out with round-half-up so 1.2 stays exact to 10 decimals (default 2 is unchanged).
  const multScaled = BigInt(Math.round(factor * 10 ** MULTIPLIER_DECIMAL_SCALE));
  const multDivisor = 10n ** BigInt(MULTIPLIER_DECIMAL_SCALE);
  const marked = (scaledCost * multScaled + multDivisor / 2n) / multDivisor; // cost × factor × 10^10

  const divisor = 10n ** BigInt(USD_CENTS_DECIMAL_SCALE);
  const whole = marked / divisor;
  const fractional = (marked % divisor).toString().padStart(USD_CENTS_DECIMAL_SCALE, "0");

  return `${whole}.${fractional}`;
}

/**
 * Apply a per-cost risk markup to a raw unit cost.
 * @param costPerUnitInUsdCents raw cost as a fixed 10-decimal string (e.g. "2.3600000000")
 * @param multiplier markup factor; defaults to COST_DEFAULT_MULTIPLIER (risk × profit = 5).
 *   Per-cost overrides allowed (e.g. 1.2). Result is rounded half-up to 10 decimals.
 */
export function applyCostRiskMultiplier(
  costPerUnitInUsdCents: string,
  multiplier: number = COST_DEFAULT_MULTIPLIER,
): string {
  return scaleFixedDecimalCost(costPerUnitInUsdCents, multiplier, "cost-risk multiplier");
}

/**
 * VAT rate the Chinese vendors add to their published list price.
 *
 * DeepSeek bills 6% VAT on top of every top-up. It is CHINESE VAT, so it cannot be
 * reclaimed through an EU VAT return — it is money we spend and never get back, which
 * makes it part of what the call costs us rather than a tax we merely advance. That is
 * the whole reason it belongs in the vendor basis instead of the markup.
 */
export const CHINA_VAT_MULTIPLIER = 1.06;

/**
 * Raise a vendor's published list price to what we actually pay, VAT included.
 *
 * Applied to the vendor cell BEFORE the store markup, so the marked-up price is a markup
 * on our real cost. The seed literals stay byte-equal to the vendor's own pricing table —
 * they are quoted as published, and this function is where the invoice differs from it.
 *
 * NOT applied fleet-wide to every Chinese vendor: Z.ai and Moonshot invoices carry no such
 * line, so adding one there would invent a cost we do not pay. If a future invoice from
 * either does show VAT, that is a price change on those names like any other. Verify
 * against an invoice before extending this — the vendor's nationality is not the test.
 */
export function withChinaVat(costPerUnitInUsdCents: string): string {
  return scaleFixedDecimalCost(costPerUnitInUsdCents, CHINA_VAT_MULTIPLIER, "VAT multiplier");
}

/**
 * How a catalog line's price relates to what the vendor charges. Two values, no third, and no
 * default anywhere: every seed row states its own class (the field is required on
 * `SeedProviderCost`, so a row that omits it does not compile) and the column is NOT NULL.
 *
 *  - `marked-up`    … work we PERFORM (LLM tokens, embeddings, enrichment, search, creative
 *                     generation). Price = vendor rate × COST_DEFAULT_MULTIPLIER.
 *  - `pass-through` … money we merely ROUTE (advertising-platform spend, payment-processing
 *                     fees). Price IS the vendor rate. The customer pays exactly what the
 *                     underlying platform charges and nothing more.
 *
 * The distinction is a commercial promise, not an implementation detail: the public pricing
 * page reads it back per line from `/v1/platform-prices`, so it lives on the row here rather
 * than as a list any consumer has to mirror.
 */
export type PricingBasis = "marked-up" | "pass-through";

/**
 * Price a line we do NOT mark up: the raw vendor rate, stored verbatim.
 *
 * Exists as a named counterpart to `applyCostRiskMultiplier` so a pass-through row reads as a
 * deliberate choice rather than a forgotten markup, and so the same fixed 10-decimal format is
 * enforced on both paths.
 */
export function passThroughVendorPrice(costPerUnitInUsdCents: string): string {
  if (!/^\d+\.\d{10}$/.test(costPerUnitInUsdCents)) {
    throw new Error(`Invalid seed cost format: ${costPerUnitInUsdCents}`);
  }
  return costPerUnitInUsdCents;
}

/**
 * Price for a line we stopped charging for: none at all.
 *
 * Used when a cost we still incur stops being rebilled to customers — the cold-email
 * infrastructure lines, whose spend moved onto our own fixed costs. The honest catalog
 * entry is the ABSENCE of a billable price, not a zero: zero would claim the work is free,
 * and it is not. The name itself is kept forever (spend already declared against it must
 * stay readable), it simply stops being advertised as something we sell.
 */
export function noLongerBillable(): null {
  return null;
}

// Domain mapping per provider (used by logo.dev on the public pricing page).
export const PROVIDER_DOMAINS: Record<string, string> = {
  apollo: "apollo.io",
  apify: "apify.com",
  anthropic: "anthropic.com",
  cloudflare: "cloudflare.com",
  deepseek: "deepseek.com",
  featured: "featured.com",
  firecrawl: "firecrawl.dev",
  google: "google.com",
  instantly: "instantly.ai",
  moonshot: "moonshot.ai",
  postmark: "postmarkapp.com",
  "scrape-do": "scrape.do",
  "serper-dev": "serper.dev",
  stripe: "stripe.com",
  twilio: "twilio.com",
  // Advertising platforms we route spend to. Each is its own provider: the plan we resolve a
  // price on is per vendor path, and `google` (Gemini) is a different commercial relationship
  // from `google-ads` even though both are Google.
  "google-ads": "ads.google.com",
  "meta-ads": "facebook.com",
  "linkedin-ads": "linkedin.com",
  "tiktok-ads": "tiktok.com",
  "youtube-ads": "youtube.com",
  "x-ads": "x.com",
  "reddit-ads": "reddit.com",
  "bing-ads": "bing.com",
  "quora-ads": "quora.com",
  // Sponsorships and directory listings have no single vendor — the money goes to whichever
  // newsletter, show, creator or directory the campaign bought. No domain, hence no logo.
  // No `vercel` entry: the AI Gateway is retired (see SEED_PLATFORM_COSTS below). The four
  // gateway-priced rows still in production carry their provider_domain on the row itself,
  // so dropping the map entry cannot change what history reads back.
  zai: "z.ai",
};

/**
 * One price point in the seed catalog.
 *
 * A cost NAME may appear more than once: each entry is a version of that name's price,
 * dated by `effectiveFrom`. The read path resolves the newest version whose
 * `effectiveFrom <= now()`, so a vendor's announced future price change is expressed by
 * adding a second entry dated at the moment the new rate takes effect — the earlier entry
 * stays as history and nothing already declared is re-priced.
 */
export interface SeedProviderCost {
  name: string;
  provider: string;
  providerDomain: string | undefined;
  type: string;
  unit: string;
  planTier: string;
  billingCycle: string;
  /**
   * The price we charge, or `null` when the line carries NO billable price any more.
   *
   * `null` is a real version like any other: it says "from this date on, this catalog line
   * is not something a customer is charged for". It is NOT a zero — a zero would assert the
   * line costs nothing, which is false (we still pay the vendor; we simply stopped passing
   * it on). Use `noLongerBillable()` so the choice reads as a decision, exactly as
   * `passThroughVendorPrice` marks a deliberate zero markup.
   *
   * A null-priced version delists the name: it disappears from `GET /v1/platform-prices`
   * and `GET /v1/providers-costs` (the current billable catalog) while every by-name read
   * still resolves it, so historical spend written against the name stays readable.
   */
  costPerUnitInUsdCents: string | null;
  /** Required — see `PricingBasis`. No default: an untagged line must not compile. */
  pricingBasis: PricingBasis;
  effectiveFrom: Date;
  /** 'peak' | 'off-peak' for a provider that charges by time of day; omitted otherwise. */
  pricingRegime?: string;
  /** UTC windows during which this regime is in force, e.g. "01:00-04:00,06:00-10:00". */
  regimeHoursUtc?: string;
}

/**
 * DeepSeek time-of-day pricing, live from 2026-08-16T16:00:00Z.
 * Read from https://api-docs.deepseek.com/quick_start/pricing on 2026-08-15.
 *
 * A window is `Days@HH:MM-HH:MM`, half-open on the minute, days as a `Mon`..`Sun` range.
 * The day scope is part of the grammar because the vendor's regime is not purely
 * time-of-day: from 2026-08-23 (00:00 Beijing, announced in the top-up console) off-peak
 * rates apply for the WHOLE day on Saturdays and Sundays, Beijing time.
 *
 * The Beijing weekend runs Friday 16:00 UTC to Sunday 16:00 UTC, which does not line up
 * with a UTC day — but it does not have to. Every peak window sits between 01:00 and 10:00
 * UTC, entirely inside the part of a UTC day that shares its weekday with Beijing, so the
 * weekend rule reduces exactly to "no peak on UTC Saturday and UTC Sunday". That reduction
 * is a property of WHERE the windows sit, not a general truth: if the vendor ever moves a
 * peak window past 16:00 UTC, the Beijing weekend starts cutting through it and these
 * strings stop being expressible as whole UTC days.
 */
export const DEEPSEEK_TIME_OF_DAY_PRICING_FROM = new Date("2026-08-16T16:00:00Z");
export const DEEPSEEK_PEAK_HOURS_UTC = "Mon-Fri@01:00-04:00,Mon-Fri@06:00-10:00";
export const DEEPSEEK_OFF_PEAK_HOURS_UTC =
  "Mon-Fri@00:00-01:00,Mon-Fri@04:00-06:00,Mon-Fri@10:00-24:00,Sat-Sun@00:00-24:00";

/**
 * Build the six DeepSeek cost names for one model — {peak, off-peak} × {input, cached input,
 * output} — each with two price points:
 *
 *  - `2025-01-01` … the rate DeepSeek charges today, which is the SAME at every hour because
 *    time-of-day pricing is not live yet. Both regimes therefore carry the same number, read
 *    from the vendor's current table.
 *  - `2026-08-16T16:00Z` … the regime rates from the vendor's future table.
 *
 * Splitting by regime from the first version (rather than only from the schedule's start)
 * keeps the selection rule total: at every instant, for every token class, exactly one cost
 * name matches the clock, so a consumer never has to fall back to a regime-free name.
 *
 * Every number is a verbatim cell from https://api-docs.deepseek.com/quick_start/pricing
 * (read 2026-08-15), converted to cents-per-token by ÷10⁴, raised by the non-recoverable
 * Chinese VAT DeepSeek adds on top of that published cell, then marked up by the store
 * multiplier. Nothing is derived from another cell — the vendor's off-peak column happens to
 * be half its peak column, but both are read, not computed.
 */
function deepSeekModelCosts(args: {
  /** Name segment, e.g. "deepseek-v4-flash". */
  namePrefix: string;
  /** Human label, e.g. "DeepSeek V4 Flash". */
  label: string;
  /** Rates in force before 2026-08-16T16:00Z (single regime, so identical for both). */
  current: { input: string; cachedInput: string; output: string };
  peak: { input: string; cachedInput: string; output: string };
  offPeak: { input: string; cachedInput: string; output: string };
}): SeedProviderCost[] {
  const base = {
    provider: "deepseek",
    providerDomain: PROVIDER_DOMAINS.deepseek,
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
  };
  const classes = [
    { suffix: "tokens-input", type: `Input tokens (${args.label}, cache miss` },
    { suffix: "tokens-cached-input", type: `Cached input tokens (${args.label}` },
    { suffix: "tokens-output", type: `Output tokens (${args.label}` },
  ] as const;
  const keys = ["input", "cachedInput", "output"] as const;
  const regimes = [
    { regime: "peak", hours: DEEPSEEK_PEAK_HOURS_UTC, rates: args.peak },
    { regime: "off-peak", hours: DEEPSEEK_OFF_PEAK_HOURS_UTC, rates: args.offPeak },
  ] as const;

  return regimes.flatMap(({ regime, hours, rates }) =>
    classes.flatMap(({ suffix, type }, i) => {
      const name = `${args.namePrefix}-${regime}-${suffix}`;
      const shared = {
        ...base,
        name,
        type: `${type}, ${regime})`,
        pricingRegime: regime,
        regimeHoursUtc: hours,
      };
      return [
        {
          ...shared,
          costPerUnitInUsdCents: applyCostRiskMultiplier(withChinaVat(args.current[keys[i]])),
          pricingBasis: "marked-up",
          effectiveFrom: new Date("2025-01-01T00:00:00Z"),
        },
        {
          ...shared,
          costPerUnitInUsdCents: applyCostRiskMultiplier(withChinaVat(rates[keys[i]])),
          pricingBasis: "marked-up",
          effectiveFrom: DEEPSEEK_TIME_OF_DAY_PRICING_FROM,
        },
      ];
    })
  );
}

/**
 * The acquisition channels we ROUTE spend to, one cost name each.
 *
 * Every one of these is billed the same way and for the same reason: the org buys placement on
 * a platform, the platform charges what it charges, and we hand that amount on untouched. So a
 * line's unit is one USD cent of platform spend and its price is exactly one cent — the
 * consumer declares `quantity` = the spend it observed in cents, and the org is charged that
 * number. There is no rate to get wrong and no margin to hide, which is the whole point of the
 * pass-through basis.
 *
 * A creative WE generate for one of these campaigns is a different line (an LLM / image cost
 * name, marked up as it is today). Buying the placement is routing; making the ad is work.
 */
const ADVERTISING_CHANNELS: { provider: string; type: string }[] = [
  { provider: "google-ads", type: "Google Ads platform spend" },
  { provider: "meta-ads", type: "Meta Ads platform spend" },
  { provider: "linkedin-ads", type: "LinkedIn Ads platform spend" },
  { provider: "tiktok-ads", type: "TikTok Ads platform spend" },
  { provider: "youtube-ads", type: "YouTube Ads platform spend" },
  { provider: "x-ads", type: "X Ads platform spend" },
  { provider: "reddit-ads", type: "Reddit Ads platform spend" },
  { provider: "bing-ads", type: "Bing Ads platform spend" },
  { provider: "quora-ads", type: "Quora Ads platform spend" },
  { provider: "newsletter-sponsorship", type: "Newsletter sponsorship spend" },
  { provider: "podcast-sponsorship", type: "Podcast sponsorship spend" },
  { provider: "creator-sponsorship", type: "Creator sponsorship spend" },
  { provider: "software-directory-listing", type: "Paid software-directory listing spend" },
];

export const ADVERTISING_CHANNEL_COSTS: SeedProviderCost[] = ADVERTISING_CHANNELS.map(
  ({ provider, type }) => ({
    name: `${provider}-spend`,
    provider,
    providerDomain: PROVIDER_DOMAINS[provider],
    type,
    unit: "USD cent",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: passThroughVendorPrice("1.0000000000"),
    pricingBasis: "pass-through",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  })
);

export const SEED_PROVIDERS_COSTS: SeedProviderCost[] = [
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0010000000"), // $0.00001 = 0.001¢ → 0.004¢
    pricingBasis: "marked-up",
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
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0890000000"), // $0.00089 = 0.089¢ → 0.356¢
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Featured.com — one pitch submit = 1 credit.
  // We hold the $99/mo Pro/Business sub (unlimited) in practice, but rebill the client at
  // a $1/2000 ($0.0005) base unit rate. Opportunity fetches are free/unlimited and are not tracked as
  // billable costs.
  {
    name: "featured-api-pitch-submit",
    provider: "featured",
    providerDomain: PROVIDER_DOMAINS.featured,
    type: "API call (pitch submit)",
    unit: "call",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0500000000"),
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3.6 Flash: $1.50/MTok input, $7.50/MTok output (standard pay-as-you-go tier).
  // Internal alias "flash-pro" routes here (replaces Gemini 3.5 Flash — same input price, cheaper output).
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-3.6-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 3.6 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0001500000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-3.6-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 3.6 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0007500000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3.7 Flash: $1.50/MTok input, $7.50/MTok output (standard pay-as-you-go tier).
  // Internal alias "flash-pro" routes here (replaces Gemini 3.6 Flash — same list price).
  // Google runs a promotion ($0.75/$3.75 per MTok) through 2026-12-31; we seed the post-promotion
  // 2027 list rate so nothing has to be repriced when it ends (same treatment as Gemini 3.6 Flash).
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-3.7-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 3.7 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0001500000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-3.7-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 3.7 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0007500000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Google Gemini 3.5 Flash-Lite: $0.30/MTok input, $2.50/MTok output (standard pay-as-you-go tier).
  // Internal alias "flash" routes here (replaces Gemini 3 Flash — cheaper input + output).
  // https://ai.google.dev/gemini-api/docs/pricing
  {
    name: "google-flash-lite-3.5-tokens-input",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Input tokens (Gemini 3.5 Flash-Lite)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000300000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "google-flash-lite-3.5-tokens-output",
    provider: "google",
    providerDomain: PROVIDER_DOMAINS.google,
    type: "Output tokens (Gemini 3.5 Flash-Lite)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0002500000"),
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // ⚠️ THE COLD-EMAIL INFRASTRUCTURE LINES ARE NO LONGER BILLABLE (2026-08).
  //
  // Instantly subscriptions, MailForge, PrimeForge and the Claude Max seat moved OFF the
  // per-customer rebill and onto our own fixed costs, and instantly-service stopped
  // declaring per-email spend — so these three names (`instantly-contact-uploaded`,
  // `instantly-account-email-sent`, `instantly-domain-email-sent`) receive no new usage and
  // must stop being advertised as a current price. The lost rebill is recovered by the
  // profit markup above (4× → 5× on everything we DO still rebill).
  //
  // They are DELISTED, not deleted, and not zeroed:
  //   - `noLongerBillable()` appends a null-priced version dated at deploy time. Every prior
  //     priced row stays exactly as written, so spend already declared still reads back at
  //     the price it was written with.
  //   - A null price drops the name from the current billable catalog
  //     (`GET /v1/platform-prices`, `GET /v1/providers-costs`) while `/:name`, `/:name/history`
  //     and `/:name/plans` keep resolving it — runs-service holds cost rows under these names
  //     and a reconcile sweep still PATCHes them.
  //   - A zero price was rejected: it would assert the line costs nothing. It does not. We
  //     still pay for the inboxes; we simply stopped passing that on.
  //   - Retiring the `instantly` PROVIDER was rejected too: these names have no newer row on
  //     another provider, so dropping the platform-cost row would 500 every by-name read
  //     (see CLAUDE.md, "Retiring a PROVIDER").
  // MailForge and PrimeForge never carried catalog lines of their own — that infra was priced
  // through the `instantly-*-email-sent` rows below — so there is nothing else to delist.
  //
  // Instantly — contact uploaded: was Growth plan $47/mo ÷ 1,000 contacts = 4.70¢/contact
  // https://instantly.ai/pricing
  {
    name: "instantly-contact-uploaded",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Contact upload",
    unit: "contact",
    planTier: "growth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: noLongerBillable(),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly — email sent per account (pre-warmed prewarmed-inbox infra). NO LONGER BILLABLE.
  // The infra model below is what this line USED to charge, kept as the record of how the
  // frozen priced rows were derived.
  // Infra model (2026-07, replaces Mailforge): a domain is bought $15/yr and hosts 5
  // pre-warmed accounts at $10/mo EACH; each account sends 30 emails/business-day max.
  //   sends/account/yr = 30 × 252 business days = 7,560
  // The "per account" row carries the per-account hosting fee PLUS the folded-in
  // deliverability-testing cost (option B — no separate cost name, so instantly-service
  // needs no new declaration; see instantly-domain-email-sent for the domain-purchase share):
  //   hosting       = $10/mo = $120/yr ÷ 7,560 sends        = 1.5873015873¢/email
  //   deliverability= $47/mo global tool = $564/yr, amortised over the whole fleet
  //                   (30 domains × 5 = 150 accounts × 7,560 = 1,134,000 sends/yr)
  //                   $564/yr ÷ 1,134,000                    = 0.0497354497¢/email
  //   account row   = 1.5873015873 + 0.0497354497           = 1.6370370370¢/email
  // (Infra was plan-agnostic, so growth + hypergrowth carried the same value.)
  {
    name: "instantly-account-email-sent",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Email send (per account)",
    unit: "email",
    planTier: "growth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: noLongerBillable(),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly — email sent per domain (pre-warmed prewarmed-inbox infra). NO LONGER BILLABLE.
  // Domain purchase $15/yr, shared by all 5 accounts' combined sends:
  //   $15/yr ÷ (7,560 sends × 5 accounts = 37,800/yr) = 0.0396825397¢/email.
  // account + domain = 1.6767195767¢/email total — the rate this line charged until it was
  // delisted; the frozen rows carry it at the markup in force when each was written.
  {
    name: "instantly-domain-email-sent",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Email send (per domain)",
    unit: "email",
    planTier: "growth",
    billingCycle: "yearly",
    costPerUnitInUsdCents: noLongerBillable(),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly Hypergrowth — contact uploaded. NO LONGER BILLABLE.
  // Was $97/mo ÷ 25,000 contacts = 0.388¢/contact
  // https://instantly.ai/pricing
  {
    name: "instantly-contact-uploaded",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Contact upload",
    unit: "contact",
    planTier: "hypergrowth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: noLongerBillable(),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly Hypergrowth — email sent per account. NO LONGER BILLABLE.
  // Same prewarmed-inbox model as Growth.
  // hosting $10/mo = $120/yr ÷ 7,560 sends = 1.5873015873¢ + deliverability (folded, option B)
  // $564/yr ÷ 1,134,000 fleet sends = 0.0497354497¢ → 1.6370370370¢/email.
  // This was the SERVED row (instantly platform cost = hypergrowth/monthly): the plan row is
  // KEPT so `/v1/platform-prices/:name` still resolves the name instead of 500-ing on a
  // provider with no plan.
  {
    name: "instantly-account-email-sent",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Email send (per account)",
    unit: "email",
    planTier: "hypergrowth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: noLongerBillable(),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Instantly Hypergrowth — email sent per domain. NO LONGER BILLABLE.
  // Same prewarmed-inbox model as Growth.
  // $15/yr domain purchase ÷ (7,560 sends × 5 accounts = 37,800/yr) = 0.0396825397¢/email.
  {
    name: "instantly-domain-email-sent",
    provider: "instantly",
    providerDomain: PROVIDER_DOMAINS.instantly,
    type: "Email send (per domain)",
    unit: "email",
    planTier: "hypergrowth",
    billingCycle: "monthly",
    costPerUnitInUsdCents: noLongerBillable(),
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Stripe — payment-processing fees (charge, refund, dispute, payout failure). PASS-THROUGH.
  // stripe-service emits one cost write per Stripe-incurred fee event, with quantity set to the
  // fee in cents (from balance_transaction.fee). Unit price is therefore 1 cent of Stripe fee,
  // and the org is charged that fee EXACTLY — we route the money, we do not resell it.
  //
  // These four rows carried the 4× markup until this version (an org paid 4¢ per 1¢ of Stripe
  // fee). Repricing them to the vendor basis is an append-only price change: the seed inserts a
  // new now()-dated row per name and the marked-up rows stay as history, so spend already
  // declared still reads back at the price it was written with.
  // https://stripe.com/pricing
  {
    name: "stripe-processing-fee",
    provider: "stripe",
    providerDomain: PROVIDER_DOMAINS.stripe,
    type: "Charge processing fee",
    unit: "USD cent",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: passThroughVendorPrice("1.0000000000"),
    pricingBasis: "pass-through",
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
    costPerUnitInUsdCents: passThroughVendorPrice("1.0000000000"),
    pricingBasis: "pass-through",
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
    costPerUnitInUsdCents: passThroughVendorPrice("1.0000000000"),
    pricingBasis: "pass-through",
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
    costPerUnitInUsdCents: passThroughVendorPrice("1.0000000000"),
    pricingBasis: "pass-through",
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
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Twilio — WhatsApp: 0.5¢ per outbound message (US, all-in per-message model).
  // Twilio moved WhatsApp to per-message pricing (Meta deprecated conversation-based
  // pricing on 2025-07-01). Price = Twilio's flat $0.005/message platform fee + Meta's
  // per-category rate; for the US Marketing/Service category the Meta rate is $0.00, so
  // the all-in per-message price is $0.005 = 0.5¢. WhatsApp outreach sends
  // marketing-category templates, so we price on that category (same single-blended-rate
  // shape as twilio-sms-segment above).
  // https://www.twilio.com/en-us/whatsapp/pricing
  {
    name: "twilio-whatsapp-message",
    provider: "twilio",
    providerDomain: PROVIDER_DOMAINS.twilio,
    type: "WhatsApp message",
    unit: "message",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.5000000000"),
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
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
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // DeepSeek — direct vendor path (the Vercel AI Gateway is being dropped from chat-service).
  // Provider is now `deepseek`: DeepSeek bills us directly, so the price basis is DeepSeek's
  // own published list price, not the gateway's resale price. The names are unchanged
  // (`deepseek-v4-{flash,pro}-tokens-{input,output}`) — chat-service's costPrefix is
  // `deepseek-v4-flash` / `deepseek-v4-pro` and must stay byte-equal.
  //
  // V4 Flash — $0.14/MTok input (cache miss), $0.28/MTok output.
  // V4 Pro   — $0.435/MTok input (cache miss), $0.87/MTok output.
  // Read from https://api-docs.deepseek.com/quick_start/pricing on 2026-08-15.
  //
  // ⚠️ THESE FOUR ROWS ARE SUPERSEDED AND FROZEN. They carry a single price per model per
  // token class, which cannot express either priced dimension DeepSeek actually bills:
  // cache-hit input (50x-120x cheaper than a miss) or the peak/off-peak schedule that starts
  // 2026-08-16T16:00Z. The replacements are the `deepseek-v4-{flash,pro}-{peak,off-peak}-
  // tokens-{input,cached-input,output}` names appended below.
  //
  // They are kept, unchanged, because the ledger froze these prices onto costs already
  // declared against them and the catalog is append-only — deleting or re-pricing them would
  // rewrite history. They still resolve, so chat-service MUST stop declaring them before
  // 2026-08-16T16:00Z: from that instant DeepSeek has no regime-free rate, and these rows
  // would under-bill peak traffic. There is no honest value to append to them — a regime-free
  // DeepSeek price stops existing rather than changing.
  {
    name: "deepseek-v4-flash-tokens-input",
    provider: "deepseek",
    providerDomain: PROVIDER_DOMAINS.deepseek,
    type: "Input tokens (DeepSeek V4 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000140000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "deepseek-v4-flash-tokens-output",
    provider: "deepseek",
    providerDomain: PROVIDER_DOMAINS.deepseek,
    type: "Output tokens (DeepSeek V4 Flash)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000280000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "deepseek-v4-pro-tokens-input",
    provider: "deepseek",
    providerDomain: PROVIDER_DOMAINS.deepseek,
    type: "Input tokens (DeepSeek V4 Pro)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000435000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "deepseek-v4-pro-tokens-output",
    provider: "deepseek",
    providerDomain: PROVIDER_DOMAINS.deepseek,
    type: "Output tokens (DeepSeek V4 Pro)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000870000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // DeepSeek — every priced dimension, per model: token class in the name, pricing regime in
  // the name, and the UTC windows that select the regime carried on the row itself.
  //
  // Vendor tables, https://api-docs.deepseek.com/quick_start/pricing (read 2026-08-15):
  //
  //   Current, per 1M tokens        | v4-flash | v4-pro
  //     Input tokens (cache hit)    | $0.0028  | $0.003625
  //     Input tokens (cache miss)   | $0.14    | $0.435
  //     Output tokens               | $0.28    | $0.87
  //
  //   From 2026-08-16 16:00 UTC     | off-peak | peak      (v4-flash)
  //     Input tokens (cache hit)    | $0.007   | $0.014
  //     Input tokens (cache miss)   | $0.22    | $0.44
  //     Output tokens               | $0.66    | $1.32
  //
  //   From 2026-08-16 16:00 UTC     | off-peak | peak      (v4-pro)
  //     Input tokens (cache hit)    | $0.022   | $0.044
  //     Input tokens (cache miss)   | $0.66    | $1.32
  //     Output tokens               | $1.98    | $3.96
  //
  //   Peak hours: 01:00-04:00 and 06:00-10:00 UTC; off-peak all other hours.
  ...deepSeekModelCosts({
    namePrefix: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    current: { input: "0.0000140000", cachedInput: "0.0000002800", output: "0.0000280000" },
    peak: { input: "0.0000440000", cachedInput: "0.0000014000", output: "0.0001320000" },
    offPeak: { input: "0.0000220000", cachedInput: "0.0000007000", output: "0.0000660000" },
  }),
  ...deepSeekModelCosts({
    namePrefix: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    current: { input: "0.0000435000", cachedInput: "0.0000003625", output: "0.0000870000" },
    peak: { input: "0.0001320000", cachedInput: "0.0000044000", output: "0.0003960000" },
    offPeak: { input: "0.0000660000", cachedInput: "0.0000022000", output: "0.0001980000" },
  }),
  // Z.ai — direct vendor path, same shape as the DeepSeek rows above.
  // GLM-4.7-FlashX — $0.07/MTok input, $0.40/MTok output.
  // GLM-5.2        — $1.40/MTok input, $4.40/MTok output.
  // GLM-5.3        — $1.40/MTok input, $4.40/MTok output (same list price as GLM-5.2).
  // Read from https://docs.z.ai/guides/overview/pricing on 2026-08-15 (4.7-FlashX, 5.2) and
  // on 2026-08-20 (5.3).
  //
  // GLM-5.3 is a drop-in successor to GLM-5.2 at an identical rate, but it is its OWN model
  // and therefore its own set of cost names — GLM-5.2 stays priced and untouched, since a
  // consumer still on 5.2 must keep resolving the rows its spend was declared with.
  //
  // Cached input is its own cost name ($0.01/MTok FlashX, $0.26/MTok GLM-5.2 and GLM-5.3) —
  // the input rows below stay at the uncached rate and the two are never blended.
  //
  // Z.ai publishes no time-of-day schedule, so these rows carry no pricing regime: one rate
  // applies at every hour and the name has no regime segment.
  {
    name: "zai-glm-4.7-flashx-tokens-input",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Input tokens (GLM-4.7-FlashX)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000070000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "zai-glm-4.7-flashx-tokens-cached-input",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Cached input tokens (GLM-4.7-FlashX)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000010000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "zai-glm-4.7-flashx-tokens-output",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Output tokens (GLM-4.7-FlashX)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000400000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "zai-glm-5.2-tokens-input",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Input tokens (GLM-5.2)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0001400000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "zai-glm-5.2-tokens-cached-input",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Cached input tokens (GLM-5.2)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000260000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "zai-glm-5.2-tokens-output",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Output tokens (GLM-5.2)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0004400000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "zai-glm-5.3-tokens-input",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Input tokens (GLM-5.3)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0001400000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "zai-glm-5.3-tokens-cached-input",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Cached input tokens (GLM-5.3)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000260000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "zai-glm-5.3-tokens-output",
    provider: "zai",
    providerDomain: PROVIDER_DOMAINS.zai,
    type: "Output tokens (GLM-5.3)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0004400000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Moonshot (Kimi) — direct vendor path, same shape as the DeepSeek and Z.ai rows above.
  // chat-service routes the `kimi-flash` / `kimi-pro` aliases to `kimi-k2.6` / `kimi-k3` on
  // Moonshot's OpenAI-compatible endpoint, with costPrefix `moonshot-kimi-k2.6` /
  // `moonshot-kimi-k3` — the names below are byte-equal to those prefixes.
  //
  // Vendor tables, per 1M tokens (USD):
  //   https://platform.kimi.ai/docs/pricing/chat-k26 (read 2026-08-16)
  //     Kimi K2.6 — input (cache miss) $0.95 · input (cache hit) $0.16 · output $4.00
  //   https://platform.kimi.ai/docs/pricing/chat-k3  (read 2026-08-16)
  //     Kimi K3   — input (cache miss) $3.00 · input (cache hit) $0.30 · output $15.00
  //
  // `platform.moonshot.ai/docs/pricing/*` 301s to `platform.kimi.ai/docs/pricing/*`; the
  // index page carries no figures, the per-model pages do. Cache-hit input is its own cost
  // name at the vendor's own rate — never blended into the uncached input row.
  //
  // Moonshot publishes no time-of-day schedule, so these rows carry no pricing regime: one
  // rate applies at every hour and the name has no regime segment.
  {
    name: "moonshot-kimi-k2.6-tokens-input",
    provider: "moonshot",
    providerDomain: PROVIDER_DOMAINS.moonshot,
    type: "Input tokens (Kimi K2.6)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000950000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "moonshot-kimi-k2.6-tokens-cached-input",
    provider: "moonshot",
    providerDomain: PROVIDER_DOMAINS.moonshot,
    type: "Cached input tokens (Kimi K2.6)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000160000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "moonshot-kimi-k2.6-tokens-output",
    provider: "moonshot",
    providerDomain: PROVIDER_DOMAINS.moonshot,
    type: "Output tokens (Kimi K2.6)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0004000000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "moonshot-kimi-k3-tokens-input",
    provider: "moonshot",
    providerDomain: PROVIDER_DOMAINS.moonshot,
    type: "Input tokens (Kimi K3)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0003000000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "moonshot-kimi-k3-tokens-cached-input",
    provider: "moonshot",
    providerDomain: PROVIDER_DOMAINS.moonshot,
    type: "Cached input tokens (Kimi K3)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0000300000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  {
    name: "moonshot-kimi-k3-tokens-output",
    provider: "moonshot",
    providerDomain: PROVIDER_DOMAINS.moonshot,
    type: "Output tokens (Kimi K3)",
    unit: "1M tokens",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    costPerUnitInUsdCents: applyCostRiskMultiplier("0.0015000000"),
    pricingBasis: "marked-up",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Advertising channels — one pass-through line per channel, see ADVERTISING_CHANNELS above.
  ...ADVERTISING_CHANNEL_COSTS,
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
  // DeepSeek — direct vendor account. Resolves the deepseek-v4-{flash,pro}-tokens-* prices
  // now that those rows carry provider `deepseek` instead of `vercel`.
  {
    provider: "deepseek",
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
  // Moonshot — direct vendor account. Resolves the moonshot-kimi-* prices.
  {
    provider: "moonshot",
    planTier: "pay-as-you-go",
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
  // ⚠️ THE `vercel` PLATFORM ROW IS RETIRED — chat-service dropped the AI Gateway in v0.51.0
  // and nothing routes through it. It is removed from this catalog rather than re-pointed:
  // there is no honest plan to declare for a provider we no longer buy from, exactly as the
  // superseded flat DeepSeek cost names were frozen rather than re-priced.
  //
  // Retirement here means "the seed stops declaring it", NOT "the rows are deleted". The seed
  // is append-only and never DELETEs, so production keeps both the `vercel` platform row and
  // the four gateway-priced `deepseek-v4-{flash,pro}-tokens-{input,output}` rows dated
  // 2025-01-01. That is deliberate: the runs ledger froze those prices onto spend already
  // declared, and reading that spend back must keep resolving the row it was written with.
  // They are inert at read time — every one of those names has a newer, vendor-priced
  // `deepseek` row in force, and both `/v1/platform-prices/:name` and
  // `/v1/providers-costs/:name` now resolve a name's provider from its NEWEST in-force row,
  // so a retired provider can never be picked up from a superseded one.
  // Z.ai — direct vendor account. Resolves the zai-glm-* prices.
  {
    provider: "zai",
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
  // Advertising channels — a cost row alone does not serve: `/v1/platform-prices/:name` joins
  // to the ACTIVE platform row for the provider and matches on (planTier, billingCycle) with no
  // fallback, so a channel missing here would 500. Every channel is bought as-you-go.
  ...ADVERTISING_CHANNELS.map(({ provider }) => ({
    provider,
    planTier: "pay-as-you-go",
    billingCycle: "monthly",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  })),
];

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function nullableSqlLiteral(value: string | null | undefined): string {
  return value == null ? "NULL" : `'${escapeSqlLiteral(value)}'`;
}

/**
 * The fewest rows a completed seed can leave behind, i.e. what a run against an EMPTY database
 * writes. Not `SEED_PROVIDERS_COSTS.length`: a cost name carries one entry per price VERSION,
 * and of the versions already in force only the newest is written (the older ones are history
 * this database never had). So the floor is one row per in-force (name, plan, cycle), plus one
 * row per scheduled entry, which is inserted verbatim at its own date.
 *
 * Counting entries instead of rows made the check a time bomb: it passed while a scheduled
 * version was still in the future and started failing the moment that version came into force,
 * which is exactly when nothing about the catalog was wrong. DeepSeek's time-of-day rates set
 * it off on 2026-08-16.
 */
export function expectedSeedRowFloor(now: Date = new Date()): number {
  const inForceKeys = new Set<string>();
  let scheduled = 0;
  for (const cost of SEED_PROVIDERS_COSTS) {
    if (cost.effectiveFrom > now) {
      scheduled += 1;
    } else {
      inForceKeys.add(`${cost.name}|${cost.planTier}|${cost.billingCycle}`);
    }
  }
  return inForceKeys.size + scheduled;
}

export async function seedProvidersCosts() {
  // APPEND-ONLY price history — NEVER overwrite a cost. For each seed row we compare its
  // cost to the LATEST existing row for (name, plan_tier, billing_cycle):
  //   - no row yet           → INSERT with the declared effective_from (first version)
  //   - cost or basis differs → INSERT a NEW row dated now() (the prior row stays as history)
  //   - both equal            → no-op (idempotent across every boot)
  // The comparison covers pricing_basis as well as the value: dropping a markup can leave the
  // number unchanged (a 1× line), and that is still a change in what we promise the customer.
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
    const columns =
      "name, provider, provider_domain, type, unit, plan_tier, billing_cycle, pricing_regime, regime_hours_utc, cost_per_unit_in_usd_cents, pricing_basis, effective_from";
    const valuesColumns =
      "name, provider, provider_domain, type, unit, plan_tier, billing_cycle, pricing_regime, regime_hours_utc, cost, basis, declared_eff";
    const valuesClause = SEED_PROVIDERS_COSTS.map(
      (c) =>
        `('${escapeSqlLiteral(c.name)}', '${escapeSqlLiteral(c.provider)}', ${nullableSqlLiteral(c.providerDomain)}::text, '${escapeSqlLiteral(c.type)}', '${escapeSqlLiteral(c.unit)}', '${escapeSqlLiteral(c.planTier)}', '${escapeSqlLiteral(c.billingCycle)}', ${nullableSqlLiteral(c.pricingRegime)}::text, ${nullableSqlLiteral(c.regimeHoursUtc)}::text, ${c.costPerUnitInUsdCents ?? "NULL"}::numeric, '${escapeSqlLiteral(c.pricingBasis)}', '${c.effectiveFrom.toISOString()}'::timestamptz)`
    ).join(", ");

    await directSql.begin(async (tx) => {
      await tx.unsafe(`SELECT pg_advisory_xact_lock(911001)`);

      // (1) SCHEDULED versions — a seed row dated in the future is a price change the vendor
      // has announced but not yet started charging. Insert it verbatim at its declared date so
      // the change is queryable ahead of time and lands by itself at the stroke of the hour;
      // the read path filters effective_from <= now(), so it serves nothing until then.
      // Keyed on the exact (name, plan_tier, billing_cycle, effective_from) — the same unique
      // index the append-only history uses — so re-seeding is a no-op.
      await tx.unsafe(`
        INSERT INTO providers_costs (${columns})
        SELECT v.name, v.provider, v.provider_domain, v.type, v.unit, v.plan_tier, v.billing_cycle, v.pricing_regime, v.regime_hours_utc, v.cost, v.basis, v.declared_eff
        FROM (VALUES ${valuesClause}) AS v (${valuesColumns})
        WHERE v.declared_eff > now()
          AND NOT EXISTS (
            SELECT 1 FROM providers_costs pc
            WHERE pc.name = v.name AND pc.plan_tier = v.plan_tier AND pc.billing_cycle = v.billing_cycle
              AND pc.effective_from = v.declared_eff
          )
      `);

      // (2) IN-FORCE version — of the seed versions whose date has arrived, the newest one is
      // what the catalog should be charging now. Compare it to the newest row already in force
      // and append a now()-dated row only when they differ.
      //
      // Both "newest" filters are bounded by now(): a scheduled row inserted by (1) must not
      // be read as the current price (it would look like a mismatch and get reverted every
      // boot), and a seed version whose date has not arrived must not be applied early.
      await tx.unsafe(`
        INSERT INTO providers_costs (${columns})
        SELECT cur.name, cur.provider, cur.provider_domain, cur.type, cur.unit, cur.plan_tier, cur.billing_cycle, cur.pricing_regime, cur.regime_hours_utc, cur.cost, cur.basis,
               CASE WHEN latest.effective_from IS NULL THEN cur.declared_eff ELSE now() END
        FROM (
          SELECT DISTINCT ON (v.name, v.plan_tier, v.billing_cycle) v.*
          FROM (VALUES ${valuesClause}) AS v (${valuesColumns})
          WHERE v.declared_eff <= now()
          ORDER BY v.name, v.plan_tier, v.billing_cycle, v.declared_eff DESC
        ) cur
        LEFT JOIN LATERAL (
          SELECT pc.cost_per_unit_in_usd_cents AS cost, pc.pricing_basis AS basis,
                 pc.regime_hours_utc AS windows, pc.effective_from
          FROM providers_costs pc
          WHERE pc.name = cur.name AND pc.plan_tier = cur.plan_tier AND pc.billing_cycle = cur.billing_cycle
            AND pc.effective_from <= now()
          ORDER BY pc.effective_from DESC
          LIMIT 1
        ) latest ON TRUE
        -- The comparison spans everything that determines WHAT a caller is charged, not just
        -- the number. The basis is here because dropping a markup is a price change even when
        -- the figure is unchanged; the regime windows are here for the same reason one step
        -- removed: they say WHEN this row's rate applies, so moving a window reprices every
        -- instant that changed sides. Leaving them out made a windows-only edit a silent
        -- no-op -- the seed wrote nothing, production kept serving the old schedule, and the
        -- deploy looked clean. Covered by seed-append-history.test.ts (AC9).
        WHERE (latest.cost, latest.basis, latest.windows)
              IS DISTINCT FROM (cur.cost, cur.basis, cur.regime_hours_utc)
      `);
    });

    const floor = expectedSeedRowFloor();
    const [{ count }] = await directSql.unsafe(`SELECT count(*)::int as count FROM providers_costs`);
    if (count < floor) {
      throw new Error(
        `[Costs Service] Seed verify failed: expected at least ${floor} rows, found ${count}. Aborting startup.`
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
