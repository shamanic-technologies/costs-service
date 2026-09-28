/**
 * Vendor costs STATED from evidence the seed cannot carry — STAFF-ONLY, like the rest of the
 * vendor-cost surface (served on `/internal/vendor-costs*` only).
 *
 * `resolveVendorCost` states a price version's vendor cost only when a vendor rate the CURRENT
 * seed records reproduces the billed price under the markup in force. Two families of versions
 * can never pass that test, and production cost rows were billed at both:
 *
 *  1. VERSIONS WHOSE SEED RATE WAS NEVER WHAT WE PAID, or is no longer in the seed. The
 *     cold-email lines (`instantly-*`) and Featured were priced on a MODEL (a plan price ÷ an
 *     assumed volume) that has nothing to do with what the sending infrastructure actually cost,
 *     and the Instantly lines are delisted, so the seed holds no rate for them at all. Their
 *     vendor cost is stated below from what we actually PAID (bank charges) allocated over the
 *     units production actually recorded — see `docs/vendor-cost-paid-allocation.md` for the
 *     charges, the units, and the arithmetic, reproducible end to end.
 *
 *  2. VERSIONS THAT NO LONGER EXIST IN `providers_costs`. Before v0.25.0 (2026-06-07) the seed
 *     OVERWROTE prices in place, so every version served before the 2026-05-03 2x risk markup
 *     was replaced by its 2x value and the row that carried it is gone. runs-service still holds
 *     cost rows that froze those prices, and no catalogue row matches them. They are
 *     RECONSTRUCTED here — never written back into `providers_costs`, which would change the
 *     billed catalogue — and appended to `GET /internal/vendor-costs` so a consumer pricing a
 *     cost row by (name, billed unit price, date) finds them.
 *
 * Nothing here touches a billed price. Each statement names the rows it applies to by the
 * billed price AND a window on the row's `created_at`, so a later version that happens to land
 * on the same billed figure is never captured.
 */
import { normalizeCents } from "./vendor-cost.js";

export type StatedDerivation =
  /** Bank charges for the service, prorated over time and divided by the units recorded. */
  | "paid-allocation"
  /** The vendor's own list price for the unit (what the vendor charged, whatever we billed). */
  | "vendor-list-price"
  /** The seed's own literal for a version overwritten in place, served at 1x (no markup yet). */
  | "seed-vendor-rate";

export type StatedUnknownReason =
  /** The provider path is retired and no invoice or rate for it was kept. */
  "vendor-rate-not-retained";

export interface VendorCostStatement {
  name: string;
  /** Plan tiers the statement covers; omitted = every tier of the name. */
  planTiers?: string[];
  billedPricePerUnitInUsdCents: string;
  /** Applies to catalogue rows whose created_at is in [createdFrom, createdTo). */
  createdFrom: Date;
  createdTo: Date;
  vendorCostPerUnitInUsdCents: string | null;
  derivation: StatedDerivation | "unknown";
  unknownReason?: StatedUnknownReason;
  note: string;
}

const d = (iso: string) => new Date(iso);
const FOREVER = d("2100-01-01T00:00:00Z");

// The sending infrastructure behind the cold-email lines, allocated by what each line priced:
//   - mailbox + domain infrastructure (Mailforge / Primeforge "FORGE", Gandi) -> the per-email
//     ACCOUNT line, per email sent;
//   - the Instantly subscription (sold by uploaded contacts)                   -> the CONTACT line;
//   - the per-email DOMAIN line is stated at 0: its domain share is inside the account line's
//     figure, and stating it twice would double-count the same charges.
// Every figure is the month's charges (each prorated over the 30 days it pays for) divided by
// the month's units, weighted over the months the version was billed in.
const SENDING_INFRA_NOTE =
  "What the sending infrastructure actually cost: bank charges for Instantly, Mailforge/Primeforge and Gandi, " +
  "each prorated over the 30 days it pays for, divided by the units production recorded that month " +
  "(docs/vendor-cost-paid-allocation.md).";
const DOMAIN_FOLDED_NOTE =
  "Stated 0: the domain and mailbox charges are allocated per email on instantly-account-email-sent, " +
  "so the per-domain line carries none of them (docs/vendor-cost-paid-allocation.md).";
const FEATURED_NOTE =
  "What Featured/Connectively actually cost: the flat monthly subscription charges, prorated over the 30 days " +
  "each pays for, divided by the pitches production submitted (docs/vendor-cost-paid-allocation.md).";

export const VENDOR_COST_STATEMENTS: VendorCostStatement[] = [
  // --- instantly-account-email-sent (versions of 2026-04-19 .. 2026-08-23) -------------------
  { name: "instantly-account-email-sent", billedPricePerUnitInUsdCents: "3.3334000000", createdFrom: d("2026-04-19T00:00:00Z"), createdTo: d("2026-05-01T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.6572392271", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
  { name: "instantly-account-email-sent", billedPricePerUnitInUsdCents: "0.1587301588", createdFrom: d("2026-06-07T00:00:00Z"), createdTo: d("2026-06-08T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.4231984164", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
  { name: "instantly-account-email-sent", billedPricePerUnitInUsdCents: "1.4285714286", createdFrom: d("2026-06-26T00:00:00Z"), createdTo: d("2026-06-27T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.5293825133", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
  { name: "instantly-account-email-sent", billedPricePerUnitInUsdCents: "3.2740740740", createdFrom: d("2026-07-01T00:00:00Z"), createdTo: d("2026-07-02T00:00:00Z"), vendorCostPerUnitInUsdCents: "3.2019983098", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
  { name: "instantly-account-email-sent", billedPricePerUnitInUsdCents: "6.5481481480", createdFrom: d("2026-07-09T00:00:00Z"), createdTo: d("2026-07-10T00:00:00Z"), vendorCostPerUnitInUsdCents: "2.7788644351", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },

  // --- instantly-domain-email-sent -------------------------------------------------------------
  { name: "instantly-domain-email-sent", billedPricePerUnitInUsdCents: "0.3968000000", createdFrom: d("2026-04-19T00:00:00Z"), createdTo: d("2026-05-01T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.0000000000", derivation: "paid-allocation", note: DOMAIN_FOLDED_NOTE },
  { name: "instantly-domain-email-sent", billedPricePerUnitInUsdCents: "0.0000000000", createdFrom: d("2026-06-07T00:00:00Z"), createdTo: d("2026-06-08T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.0000000000", derivation: "paid-allocation", note: DOMAIN_FOLDED_NOTE },
  { name: "instantly-domain-email-sent", billedPricePerUnitInUsdCents: "0.5158730158", createdFrom: d("2026-06-26T00:00:00Z"), createdTo: d("2026-06-27T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.0000000000", derivation: "paid-allocation", note: DOMAIN_FOLDED_NOTE },
  { name: "instantly-domain-email-sent", billedPricePerUnitInUsdCents: "0.0793650794", createdFrom: d("2026-07-01T00:00:00Z"), createdTo: d("2026-07-02T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.0000000000", derivation: "paid-allocation", note: DOMAIN_FOLDED_NOTE },
  { name: "instantly-domain-email-sent", billedPricePerUnitInUsdCents: "0.1587301588", createdFrom: d("2026-07-09T00:00:00Z"), createdTo: d("2026-07-10T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.0000000000", derivation: "paid-allocation", note: DOMAIN_FOLDED_NOTE },

  // --- instantly-contact-uploaded (growth rows were never billed; same paid figure, plan-agnostic)
  { name: "instantly-contact-uploaded", billedPricePerUnitInUsdCents: "0.7760000000", createdFrom: d("2026-04-19T00:00:00Z"), createdTo: d("2026-05-01T00:00:00Z"), vendorCostPerUnitInUsdCents: "1.2570362824", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
  { name: "instantly-contact-uploaded", billedPricePerUnitInUsdCents: "9.4000000000", createdFrom: d("2026-04-19T00:00:00Z"), createdTo: d("2026-05-01T00:00:00Z"), vendorCostPerUnitInUsdCents: "1.2570362824", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
  { name: "instantly-contact-uploaded", billedPricePerUnitInUsdCents: "1.5520000000", createdFrom: d("2026-07-09T00:00:00Z"), createdTo: d("2026-07-10T00:00:00Z"), vendorCostPerUnitInUsdCents: "7.5189025220", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
  { name: "instantly-contact-uploaded", billedPricePerUnitInUsdCents: "18.8000000000", createdFrom: d("2026-07-09T00:00:00Z"), createdTo: d("2026-07-10T00:00:00Z"), vendorCostPerUnitInUsdCents: "7.5189025220", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },

  // --- featured-api-pitch-submit: every version pitches were actually billed at --------------
  // (Later versions carry no billed pitch — Featured has not been used since 2026-08-05 — and
  // keep the seed's statement.)
  { name: "featured-api-pitch-submit", billedPricePerUnitInUsdCents: "198.0000000000", createdFrom: d("2026-05-13T00:00:00Z"), createdTo: d("2026-05-14T00:00:00Z"), vendorCostPerUnitInUsdCents: "16.5000000000", derivation: "paid-allocation", note: FEATURED_NOTE },
  { name: "featured-api-pitch-submit", billedPricePerUnitInUsdCents: "1398.0000000000", createdFrom: d("2026-06-05T00:00:00Z"), createdTo: d("2026-06-06T00:00:00Z"), vendorCostPerUnitInUsdCents: "16.5000000000", derivation: "paid-allocation", note: FEATURED_NOTE },
  { name: "featured-api-pitch-submit", billedPricePerUnitInUsdCents: "200.0000000000", createdFrom: d("2026-06-09T00:00:00Z"), createdTo: d("2026-06-10T00:00:00Z"), vendorCostPerUnitInUsdCents: "16.5000000000", derivation: "paid-allocation", note: FEATURED_NOTE },
  { name: "featured-api-pitch-submit", billedPricePerUnitInUsdCents: "0.1000000000", createdFrom: d("2026-06-29T00:00:00Z"), createdTo: d("2026-06-30T00:00:00Z"), vendorCostPerUnitInUsdCents: "22.1254857997", derivation: "paid-allocation", note: FEATURED_NOTE },
  { name: "featured-api-pitch-submit", billedPricePerUnitInUsdCents: "0.2000000000", createdFrom: d("2026-07-09T00:00:00Z"), createdTo: d("2026-07-10T00:00:00Z"), vendorCostPerUnitInUsdCents: "23.7789929340", derivation: "paid-allocation", note: FEATURED_NOTE },
  // Opportunity fetches are free and unlimited on the plan.
  { name: "featured-api-opportunity-fetch", billedPricePerUnitInUsdCents: "0.0000000000", createdFrom: d("2026-05-13T00:00:00Z"), createdTo: FOREVER, vendorCostPerUnitInUsdCents: "0.0000000000", derivation: "vendor-list-price", note: "Opportunity fetches are free and unlimited on the Featured plan." },

  // --- Claude Fable 5.1 / GPT-6 Astra: the 2026-09-09 rows were stored 10x LOW (v0.55.0 -> v0.56.0).
  // The billed row is wrong; what the vendor charged per token is its list price, as the corrected
  // seed states it (asserted in tests/unit/vendor-cost-statements.test.ts).
  ...([
    ["anthropic-fable-5.1-tokens-input", "0.0006000000", "0.0010000000"],
    ["anthropic-fable-5.1-tokens-cached-input", "0.0000150000", "0.0000250000"],
    ["anthropic-fable-5.1-tokens-output", "0.0030000000", "0.0050000000"],
    ["openai-gpt-6-astra-tokens-input", "0.0006000000", "0.0010000000"],
    ["openai-gpt-6-astra-tokens-cached-input", "0.0000600000", "0.0001000000"],
    ["openai-gpt-6-astra-tokens-output", "0.0030000000", "0.0050000000"],
  ] as const).map(([name, billed, vendor]): VendorCostStatement => ({
    name,
    billedPricePerUnitInUsdCents: billed,
    createdFrom: d("2026-09-09T11:00:00Z"),
    createdTo: d("2026-09-09T11:15:00Z"),
    vendorCostPerUnitInUsdCents: vendor,
    derivation: "vendor-list-price",
    note: "Seeded 10x low on 2026-09-09 and corrected in v0.56.0; the vendor charged its list price per token, as the corrected seed states.",
  })),

  // --- DeepSeek through the Vercel AI Gateway (retired in v0.46.0): no invoice kept, no rate on
  // record for what the gateway charged, and no cost row was ever billed at these prices.
  ...([
    ["deepseek-v4-flash-tokens-input", "0.0001760000", "2026-08-14T10:00:00Z"],
    ["deepseek-v4-flash-tokens-output", "0.0005280000", "2026-08-14T10:00:00Z"],
    ["deepseek-v4-pro-tokens-input", "0.0006960000", "2026-08-15T10:00:00Z"],
    ["deepseek-v4-pro-tokens-output", "0.0013920000", "2026-08-15T10:00:00Z"],
  ] as const).map(([name, billed, from]): VendorCostStatement => ({
    name,
    planTiers: ["pay-as-you-go"],
    billedPricePerUnitInUsdCents: billed,
    createdFrom: d(from),
    createdTo: new Date(d(from).getTime() + 3_600_000),
    vendorCostPerUnitInUsdCents: null,
    derivation: "unknown",
    unknownReason: "vendor-rate-not-retained",
    note: "Served for about a day through the Vercel AI Gateway, retired in v0.46.0: what the gateway charged per token was never recorded and no invoice was kept. No cost row was billed at this price.",
  })),
];

/** The statement covering a catalogue row, or null. Throws if two cover it (a data bug). */
export function findVendorCostStatement(row: {
  name: string;
  planTier: string;
  costPerUnitInUsdCents: string | null;
  createdAt: Date;
}): VendorCostStatement | null {
  if (row.costPerUnitInUsdCents === null) return null;
  const billed = normalizeCents(row.costPerUnitInUsdCents);
  const hits = VENDOR_COST_STATEMENTS.filter(
    (s) =>
      s.name === row.name &&
      (!s.planTiers || s.planTiers.includes(row.planTier)) &&
      normalizeCents(s.billedPricePerUnitInUsdCents) === billed &&
      s.createdFrom <= row.createdAt &&
      row.createdAt < s.createdTo,
  );
  if (hits.length > 1) throw new Error(`Two vendor-cost statements cover '${row.name}' at ${billed}.`);
  return hits[0] ?? null;
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
  derivation: StatedDerivation;
  note: string;
}

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
  // The cold-email lines' pre-markup versions: stated from what we paid, like their successors.
  { name: "instantly-email-send", provider: "instantly", planTier: "hypergrowth", billingCycle: "monthly", billedPricePerUnitInUsdCents: "0.9400000000", servedFrom: d("2026-02-10T00:00:00Z"), vendorCostPerUnitInUsdCents: "6.8469579746", derivation: "paid-allocation", note: "Single cold-email line until 2026-04-19: every sending-infrastructure charge (Instantly, Gandi) prorated per month, divided by the emails sent that month (docs/vendor-cost-paid-allocation.md)." },
  { name: "instantly-account-email-sent", provider: "instantly", planTier: "hypergrowth", billingCycle: "monthly", billedPricePerUnitInUsdCents: "1.6667000000", servedFrom: d("2026-04-20T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.3050234605", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
  { name: "instantly-domain-email-sent", provider: "instantly", planTier: "hypergrowth", billingCycle: "monthly", billedPricePerUnitInUsdCents: "0.1984000000", servedFrom: d("2026-04-20T00:00:00Z"), vendorCostPerUnitInUsdCents: "0.0000000000", derivation: "paid-allocation", note: DOMAIN_FOLDED_NOTE },
  { name: "instantly-contact-uploaded", provider: "instantly", planTier: "hypergrowth", billingCycle: "monthly", billedPricePerUnitInUsdCents: "0.3880000000", servedFrom: d("2026-04-20T00:00:00Z"), vendorCostPerUnitInUsdCents: "2.3216129950", derivation: "paid-allocation", note: SENDING_INFRA_NOTE },
];
