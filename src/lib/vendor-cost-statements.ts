/**
 * The vendor rate (price WITHOUT our markup) each cost line carried at the time, where the
 * CURRENT seed no longer carries it — STAFF-ONLY, like the rest of the vendor-cost surface.
 *
 * `resolveVendorCost` states a version's vendor cost when a vendor rate the seed records
 * reproduces the billed price under the markup in force when the version was written. It only
 * knew the rates the CURRENT seed holds, so every version whose rate has since been edited out
 * of the seed read "unknown" — the delisted Instantly lines, early Featured, the 10x mis-seeded
 * Fable/Astra rows, the Vercel-gateway DeepSeek rows. Their rates are still in the seed's git
 * history; they are listed here verbatim, so the same exact reproduction states them. Nothing is
 * estimated and no other cost is added: vendor cost = billed / the markup of the day, and only
 * where that quotient is a literal the seed actually carried.
 */
import { normalizeCents } from "./vendor-cost.js";

export interface HistoricalSeedVendorRate {
  name: string;
  planTier: string;
  billingCycle: string;
  /** The seed's vendor literal (cents per unit, before markup), byte-equal to git history. */
  vendorCostPerUnitInUsdCents: string;
}

// [name, planTier, billingCycle, vendor literal]
const HISTORICAL: [string, string, string, string][] = [
  // Instantly (delisted 2026-08-23; each literal is one of the seed's successive infra models)
  ...["growth|monthly", "hypergrowth|monthly"].flatMap((pc) => {
    const [t, c] = pc.split("|");
    return ["1.6667000000", "0.0793650794", "0.7142857143", "1.6370370370"].map(
      (v): [string, string, string, string] => ["instantly-account-email-sent", t, c, v],
    );
  }),
  ...["growth|yearly", "hypergrowth|monthly"].flatMap((pc) => {
    const [t, c] = pc.split("|");
    return ["0.1984000000", "0.0000000000", "0.2579365079", "0.0396825397"].map(
      (v): [string, string, string, string] => ["instantly-domain-email-sent", t, c, v],
    );
  }),
  ["instantly-contact-uploaded", "growth", "monthly", "4.7000000000"],
  ["instantly-contact-uploaded", "hypergrowth", "monthly", "0.3880000000"],
  // Featured, before the 2026-06-29 "$1/2000" rebill base
  ["featured-api-pitch-submit", "premium", "monthly", "99.0000000000"],
  ["featured-api-pitch-submit", "pay-as-you-go", "monthly", "699.0000000000"],
  ["featured-api-pitch-submit", "pay-as-you-go", "monthly", "100.0000000000"],
  ["featured-api-opportunity-fetch", "premium", "monthly", "0.0000000000"],
  // Claude Fable 5.1 / GPT-6 Astra as first seeded on 2026-09-09 (10x low, corrected in v0.56.0)
  ["anthropic-fable-5.1-tokens-input", "pay-as-you-go", "monthly", "0.0001000000"],
  ["anthropic-fable-5.1-tokens-cached-input", "pay-as-you-go", "monthly", "0.0000025000"],
  ["anthropic-fable-5.1-tokens-output", "pay-as-you-go", "monthly", "0.0005000000"],
  ["openai-gpt-6-astra-tokens-input", "pay-as-you-go", "monthly", "0.0001000000"],
  ["openai-gpt-6-astra-tokens-cached-input", "pay-as-you-go", "monthly", "0.0000100000"],
  ["openai-gpt-6-astra-tokens-output", "pay-as-you-go", "monthly", "0.0005000000"],
  // DeepSeek V4 through the Vercel AI Gateway (retired in v0.46.0)
  ["deepseek-v4-flash-tokens-input", "pay-as-you-go", "monthly", "0.0000440000"],
  ["deepseek-v4-flash-tokens-output", "pay-as-you-go", "monthly", "0.0001320000"],
  ["deepseek-v4-pro-tokens-input", "pay-as-you-go", "monthly", "0.0001740000"],
  ["deepseek-v4-pro-tokens-output", "pay-as-you-go", "monthly", "0.0003480000"],
];

export const HISTORICAL_SEED_VENDOR_RATES: HistoricalSeedVendorRate[] = HISTORICAL.map(
  ([name, planTier, billingCycle, vendorCostPerUnitInUsdCents]) => ({ name, planTier, billingCycle, vendorCostPerUnitInUsdCents }),
);

/** Current seed rates plus the historical ones, keyed like `seedVendorRatesByKey`. */
export function withHistoricalSeedRates(current: Map<string, Set<string>>): Map<string, Set<string>> {
  const merged = new Map([...current].map(([k, v]) => [k, new Set(v)]));
  for (const r of HISTORICAL_SEED_VENDOR_RATES) {
    const key = `${r.name}|${r.planTier}|${r.billingCycle}`;
    if (!merged.has(key)) merged.set(key, new Set());
    merged.get(key)!.add(normalizeCents(r.vendorCostPerUnitInUsdCents));
  }
  return merged;
}

// --- Reconstructed versions (overwritten in place before v0.25.0) --------------------------------

export interface ReconstructedPriceVersion {
  name: string;
  provider: string;
  planTier: string;
  billingCycle: string;
  billedPricePerUnitInUsdCents: string;
  /** First day a production cost row froze this price: the version was served by then. */
  servedFrom: Date;
  vendorCostPerUnitInUsdCents: string;
  derivation: "seed-vendor-rate";
  note: string;
}

const d = (iso: string) => new Date(iso);

const PRE_MARKUP_NOTE =
  "Served before the 2026-05-03 risk markup, when the catalogue stored the vendor rate itself (1x); the row was " +
  "overwritten in place by the seed before v0.25.0, so it is reconstructed from the seed literal in git history.";

// [name, provider, planTier, billingCycle, billed (= vendor at 1x), first day billed]
const PRE_MARKUP_VERSIONS: [string, string, string, string, string, string][] = [
  ["anthropic-haiku-4.5-tokens-input", "anthropic", "pay-as-you-go", "monthly", "0.0001000000", "2026-03-27"],
  ["anthropic-haiku-4.5-tokens-output", "anthropic", "pay-as-you-go", "monthly", "0.0005000000", "2026-03-27"],
  ["anthropic-opus-4.5-tokens-input", "anthropic", "pay-as-you-go", "monthly", "0.0005000000", "2026-02-02"],
  ["anthropic-opus-4.5-tokens-output", "anthropic", "pay-as-you-go", "monthly", "0.0025000000", "2026-02-02"],
  ["anthropic-opus-4.6-tokens-input", "anthropic", "pay-as-you-go", "monthly", "0.0005000000", "2026-02-18"],
  ["anthropic-opus-4.6-tokens-output", "anthropic", "pay-as-you-go", "monthly", "0.0025000000", "2026-02-18"],
  ["anthropic-sonnet-4.6-tokens-input", "anthropic", "pay-as-you-go", "monthly", "0.0003000000", "2026-02-18"],
  ["anthropic-sonnet-4.6-tokens-output", "anthropic", "pay-as-you-go", "monthly", "0.0015000000", "2026-02-18"],
  ["apollo-credit", "apollo", "basic", "monthly", "2.3600000000", "2026-04-30"],
  ["apollo-enrichment-credit", "apollo", "basic", "monthly", "0.9800000000", "2026-02-02"],
  ["apollo-enrichment-credit", "apollo", "basic", "monthly", "2.3600000000", "2026-03-12"],
  ["apollo-person-match-credit", "apollo", "basic", "monthly", "2.3600000000", "2026-03-27"],
  ["apollo-search-credit", "apollo", "basic", "monthly", "0.0000000000", "2026-02-02"],
  ["firecrawl-extract-token", "firecrawl", "hobby", "monthly", "0.0422222222", "2026-03-27"],
  ["firecrawl-map-credit", "firecrawl", "hobby", "monthly", "0.6333333333", "2026-02-24"],
  ["firecrawl-scrape-credit", "firecrawl", "hobby", "monthly", "0.6333333333", "2026-02-08"],
  ["gemini-3-flash-tokens-input", "google", "pay-as-you-go", "monthly", "0.0000500000", "2026-02-26"],
  ["gemini-3-flash-tokens-output", "google", "pay-as-you-go", "monthly", "0.0003000000", "2026-02-26"],
  ["google-flash-3-tokens-input", "google", "pay-as-you-go", "monthly", "0.0000500000", "2026-04-02"],
  ["google-flash-3-tokens-output", "google", "pay-as-you-go", "monthly", "0.0003000000", "2026-04-02"],
  ["google-flash-lite-3.1-tokens-input", "google", "pay-as-you-go", "monthly", "0.0000250000", "2026-04-02"],
  ["google-flash-lite-3.1-tokens-output", "google", "pay-as-you-go", "monthly", "0.0001500000", "2026-04-02"],
  ["google-pro-3.1-tokens-input", "google", "pay-as-you-go", "monthly", "0.0002000000", "2026-04-02"],
  ["google-pro-3.1-tokens-output", "google", "pay-as-you-go", "monthly", "0.0012000000", "2026-04-02"],
  ["postmark-email-send", "postmark", "pro-10k", "monthly", "0.1800000000", "2026-02-05"],
  ["postmark-email-send", "postmark", "pro-10k", "monthly", "0.1650000000", "2026-03-06"],
  ["scrape-do-credit", "scrape-do", "hobby", "monthly", "0.0116000000", "2026-04-22"],
  ["scrape-do-render-credit", "scrape-do", "hobby", "monthly", "0.0348000000", "2026-04-22"],
  ["scrape-do-render-super-credit", "scrape-do", "hobby", "monthly", "0.0928000000", "2026-04-22"],
  ["scrape-do-scrape-credit", "scrape-do", "hobby", "monthly", "0.0116000000", "2026-04-14"],
  ["serper-dev-query", "serper", "pay-as-you-go", "monthly", "0.1000000000", "2026-03-27"],
  ["serper-dev-search-query", "serper", "pay-as-you-go", "monthly", "0.1000000000", "2026-03-27"],
];

export const RECONSTRUCTED_PRICE_VERSIONS: ReconstructedPriceVersion[] = [
  ...PRE_MARKUP_VERSIONS.map(([name, provider, planTier, billingCycle, billed, from]): ReconstructedPriceVersion => ({
    name,
    provider,
    planTier,
    billingCycle,
    billedPricePerUnitInUsdCents: billed,
    servedFrom: d(`${from}T00:00:00Z`),
    vendorCostPerUnitInUsdCents: billed,
    derivation: "seed-vendor-rate",
    note: PRE_MARKUP_NOTE,
  })),
  // The cold-email lines' pre-markup versions, same rule: served at 1x, so vendor = billed.
  ...([
    ["instantly-email-send", "0.9400000000", "2026-02-10"],
    ["instantly-account-email-sent", "1.6667000000", "2026-04-20"],
    ["instantly-domain-email-sent", "0.1984000000", "2026-04-20"],
    ["instantly-contact-uploaded", "0.3880000000", "2026-04-20"],
  ] as const).map(([name, billed, from]): ReconstructedPriceVersion => ({
    name,
    provider: "instantly",
    planTier: "hypergrowth",
    billingCycle: "monthly",
    billedPricePerUnitInUsdCents: billed,
    servedFrom: d(`${from}T00:00:00Z`),
    vendorCostPerUnitInUsdCents: billed,
    derivation: "seed-vendor-rate",
    note: PRE_MARKUP_NOTE,
  })),
];
