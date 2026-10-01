/**
 * Owner-reviewable declarations of the REAL cost per unit and the PROPOSED price list
 * (`src/lib/real-cost.ts`, `GET /internal/real-costs`, `/internal/price-lists`,
 * `/internal/price-comparison`). DISPLAY ONLY until the owner's go: nothing here changes a
 * catalogue price, and no billed price reads the proposed list.
 *
 * Owner rules (2026-10-01):
 * - real cost per unit, per cost item, daily since 2026-01-01:
 *   - email infrastructure = the email send price (`/internal/email-send-price`);
 *   - a vendor subscription = its real cost per credit (`/internal/subscription-costs`);
 *   - a pay-as-you-go vendor = catalogue vendor unit cost x (net paid to that vendor per the bank
 *     ledger since 2026-01-01 / the vendor cost our runs recorded for it over the same span);
 *   - Stripe and media (every `pass-through` line) = the vendor rate, as routed;
 *   - no ledger line or no recorded usage = the catalogue vendor cost, flagged.
 * - proposed price = real cost x PROPOSED_MULTIPLIER for production tools, x1 for Stripe and
 *   media; a subscription item with no real cost per credit (Hunter, Explee) keeps its current
 *   catalogue price, flagged.
 */

export const REAL_COST_SINCE = "2026-01-01";

/** Global multiplier on real cost for every production tool. */
export const PROPOSED_MULTIPLIER = 2;

/**
 * x1 list: money we ROUTE rather than work we perform. Declared as the catalogue's own
 * classification (`pricing_basis = 'pass-through'`: Stripe processing fees, advertising spend,
 * sponsorships, software-directory listings) so a new routed line joins it without a second list.
 */
export const PASS_THROUGH_MULTIPLIER = 1;
export const X1_RULE = "Every pass-through line (Stripe processing fees and media spend: ads, sponsorships, directory listings) is proposed at its real cost x1";

/**
 * The email send price is the cost of ONE email to a lead. runs-service recorded each email under
 * two names at once (one per sending account, one per sending domain), so the price is split
 * evenly between them: a unit of each, together, costs one email.
 */
export const EMAIL_SEND_COST_SHARES: Readonly<Record<string, number>> = {
  "instantly-account-email-sent": 0.5,
  "instantly-domain-email-sent": 0.5,
};

/**
 * Pay-as-you-go vendors and the bank-ledger vendor keys that are spend on the WORK our runs
 * record. `ledgerVendors` = exact keys; `ledgerVendorPrefix` = every ledger key starting with it,
 * as words (Google Cloud bills one ledger vendor per GCP project). A key named here that the ledger
 * never paid fails the refresh loud. `excludedLedgerVendors` documents look-alikes left out.
 * A catalogue provider not listed here (and not a subscription, email infrastructure or
 * pass-through) keeps its catalogue vendor cost, flagged `no-ledger-line`.
 */
export type PayAsYouGoVendor = {
  provider: string;
  ledgerVendors: readonly string[];
  ledgerVendorPrefix: string | null;
  excludedLedgerVendors: readonly { key: string; reason: string }[];
};

export const PAY_AS_YOU_GO_VENDORS: readonly PayAsYouGoVendor[] = [
  {
    provider: "anthropic",
    ledgerVendors: ["anthropic", "anthropic ireland"],
    ledgerVendorPrefix: null,
    excludedLedgerVendors: [{ key: "anthropic claude sub", reason: "Claude seat subscription, not API usage" }],
  },
  {
    provider: "google",
    ledgerVendors: [],
    ledgerVendorPrefix: "google cloud",
    excludedLedgerVendors: [
      { key: "google one", reason: "Personal storage, not API usage" },
      { key: "google workspace", reason: "Mailboxes, not API usage" },
      { key: "google youtube", reason: "Not API usage" },
      { key: "google google play", reason: "Not API usage" },
    ],
  },
  { provider: "deepseek", ledgerVendors: ["deepseek"], ledgerVendorPrefix: null, excludedLedgerVendors: [] },
  {
    provider: "openai",
    ledgerVendors: ["openai"],
    ledgerVendorPrefix: null,
    excludedLedgerVendors: [{ key: "openai chatgpt subscr", reason: "ChatGPT seat subscription, not API usage" }],
  },
  { provider: "moonshot", ledgerVendors: ["moonshot ai", "moonshot ai pte"], ledgerVendorPrefix: null, excludedLedgerVendors: [] },
  { provider: "twilio", ledgerVendors: ["twilio com"], ledgerVendorPrefix: null, excludedLedgerVendors: [] },
  { provider: "treg", ledgerVendors: ["treg"], ledgerVendorPrefix: null, excludedLedgerVendors: [] },
];

/** Providers deliberately kept on their catalogue vendor cost, with the reason (served as the flag's detail). */
export const CATALOGUE_VENDOR_COST_PROVIDERS: Readonly<Record<string, string>> = {
  cloudflare: "The Cloudflare ledger line also pays DNS for the sending domains, already counted in the email send price",
};

/** Ledger keys of a prefix declaration, as whole words ("google cloud" matches "google cloud rxxsxl", not "google cloudy"). */
export function matchesPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix} `);
}
