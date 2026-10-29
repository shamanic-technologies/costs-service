/**
 * Owner-reviewable declarations of the REAL cost per unit and the PROPOSED price list
 * (`src/lib/real-cost.ts`, `GET /internal/real-costs`, `/internal/price-lists`,
 * `/internal/price-comparison`). BILLED since the owner's go of 2026-10-02: after every refresh the
 * day's proposed price of each cost item becomes its catalogue price (src/lib/catalogue-sync.ts), so a
 * change here changes what every customer pays from the next refresh on.
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

/**
 * Global multiplier on real cost for every production tool, on the GRANDFATHERED list: what every
 * account created before `STANDARD_PRICE_LIST_FROM` keeps paying (owner 2026-10-29: « Les clients
 * actuels sont aussi grandfathered avec le pricing x2 »). This is the list `providers_costs`
 * bills by its price column.
 */
export const PROPOSED_MULTIPLIER = 2;

/**
 * Multiplier on real cost on the STANDARD list: what every account created at or after
 * `STANDARD_PRICE_LIST_FROM` pays, and what the public catalogue shows (owner 2026-10-29: « Free,
 * hosted for them, 1 user, no markup. On baisse nos prix de refacturation de 2x -> 1x. On enlève
 * notre marge. »). Same rules as the grandfathered list otherwise: pass-through x1, the email
 * verdict multiples, a subscription credit never below its vendor list cost, and every support
 * cost (onboarding LLM calls, chat tokens, payment fees) priced like any other action.
 */
export const STANDARD_MULTIPLIER = 1;

/**
 * The ship instant of the x1 list. An org (client-service `orgs.created_at`) created before it is
 * GRANDFATHERED at x2; one created at or after it pays the STANDARD list. Never move it: moving it
 * reprices every org created between the two instants.
 */
export const STANDARD_PRICE_LIST_FROM = new Date("2026-10-29T14:00:00.000Z");

export type PriceListName = "standard" | "grandfathered";

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
 * evenly between them: a unit of each, together, costs one email. Before that split, each email
 * was one `instantly-email-send` unit: the whole price.
 */
/**
 * The price of one email depends on how sure we are the address exists: its verdict from our email
 * verifier, BounceVerify (owner 2026-10-14: « Le prix qu'on a donné et qu'on calcule aujourd'hui doit
 * correspondre aux valid [...] Si un user nous utilise pour un catch all, on x2 ce prix dans notre
 * catalogue. Si un unknown on x3. »). `valid` is the email send price as it always was, under the
 * original names; every other verdict is a STATED multiple of it, so a change of the valid price moves
 * all of them. invalid, risky and no verdict are never sent: they have no name and no price.
 * The real cost of an email is the same whatever the verdict; only the proposed (billed) price moves.
 */
export const EMAIL_VERIFIER = "BounceVerify";
export type EmailVerdict = { verdict: "valid" | "catch_all" | "unknown"; label: string; nameSuffix: string; priceMultipleOfValid: number };
export const EMAIL_VERDICTS: readonly EmailVerdict[] = [
  { verdict: "valid", label: "valid", nameSuffix: "", priceMultipleOfValid: 1 },
  { verdict: "catch_all", label: "catch-all", nameSuffix: "-catch-all", priceMultipleOfValid: 2 },
  { verdict: "unknown", label: "unknown", nameSuffix: "-unknown", priceMultipleOfValid: 3 },
];
/** The two names one email is declared under (one per sending account, one per sending domain). */
export const EMAIL_SENT_BASE_NAMES = ["instantly-account-email-sent", "instantly-domain-email-sent"] as const;

/** The verdict a cost name prices (`valid` for the base names), or null for a non-email name. */
export function emailVerdictOf(costName: string): EmailVerdict | null {
  for (const v of EMAIL_VERDICTS) {
    if (EMAIL_SENT_BASE_NAMES.some((b) => `${b}${v.nameSuffix}` === costName)) return v;
  }
  return null;
}

export const EMAIL_SEND_COST_SHARES: Readonly<Record<string, number>> = {
  ...Object.fromEntries(EMAIL_VERDICTS.flatMap((v) => EMAIL_SENT_BASE_NAMES.map((b) => [`${b}${v.nameSuffix}`, 0.5]))),
  "instantly-email-send": 1,
};

/**
 * Units that cost nothing more at the vendor: their spend is already inside another real cost.
 * Real cost 0 (declared, flagged `included-in-another-cost`), so the proposed price is 0 too.
 */
export const INCLUDED_AT_VENDOR: Readonly<Record<string, string>> = {
  "apollo-search-credit": "Apollo does not deduct credits for search",
  "instantly-contact-uploaded": "Uploads are included in the Instantly subscription, already counted in the email send price",
};

/**
 * Names runs-service recorded that the catalogue no longer carries under that name: priced like
 * their successor on each day (flag `legacy-name-priced-as-successor`).
 */
export const LEGACY_COST_NAMES: Readonly<Record<string, { successor: string; reason: string }>> = {
  "gemini-3-flash-tokens-input": { successor: "google-flash-3-tokens-input", reason: "Renamed gemini -> google" },
  "gemini-3-flash-tokens-output": { successor: "google-flash-3-tokens-output", reason: "Renamed gemini -> google" },
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
  /** What the ratio's numerator counts as METERED spend (the work our runs record). Default: the ledger net paid. */
  meteredSpend?: MeteredSpendSource;
};

/**
 * Where a vendor's METERED spend is read when the bank line also pays for something else.
 *
 * `twilio-usage`: Twilio is prepaid. A bank line is a balance top-up; the balance then pays the
 * metered usage our runs record AND the phone-number rental (a subscription), and what is left is
 * not consumed yet. So the numerator is what Twilio's own usage records priced for the metered
 * categories; the rental, any other category, the balance left and the bank money Twilio cannot
 * explain (paid to an earlier Twilio account, 2026-03) are served apart, never loaded on a unit.
 * Categories are Twilio's top-level ones (a child like `calls-outbound` would count twice).
 */
export type MeteredSpendSource =
  | {
      kind: "twilio-usage";
      /**
       * The ONE Twilio account whose spend counts (owner 2026-10-01): the bank line "twilio com" can
       * pay several accounts; any other account's money stays in `unexplained`, never on a unit.
       * The platform key must open exactly this account (matched on Twilio's friendly name).
       */
      account: string;
      meteredCategories: readonly string[];
      rentalCategories: readonly string[];
    }
  | {
      /**
       * Google Cloud: the bank's "google cloud" block also pays Secret Manager / Cloud Run, invoice tax,
       * prepaid top-ups and, before the billing export began (2026-07-30), money no service line explains.
       * Read from the bank ledger's split (`/api/v1/vendor-payments/google-cloud`, from the GCP billing
       * export). The numerator is the consumption of `meteredServices` only, from the first day the export
       * covers; the recorded vendor cost is counted from that same day so both sides span one window.
       * Prepaid top-ups count only as the export shows them consumed (inside the services' consumption).
       * Only `meteredServices` billed to `meteredProjects` count: another GCP project's spend (on any
       * service) is not ours to load. In a month the export only half covers, a metered project's
       * consumption before the export began (`projects[].uncoveredEur`, inferred by the ledger from the
       * invoice tax) is counted as its own part, spread over those earlier days.
       */
      kind: "google-cloud-split";
      meteredServices: readonly string[];
      meteredProjects: readonly string[];
    };

/**
 * Tax on a vendor invoice is NOT part of the real cost (owner 2026-10-01: tax counts only if not
 * recoverable, and VAT/tax lines are declared recoverable). Served apart, flagged, never loaded.
 * (DeepSeek's Chinese VAT is a different case: it is inside the catalogue vendor rate, `withChinaVat`.)
 */
export const TAX_IS_REAL_COST = false;

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
    // The platform "google" key lived in MCP Factory until 2026-10-01 17:35 UTC, in Distribute from then.
    meteredSpend: { kind: "google-cloud-split", meteredServices: ["Gemini API"], meteredProjects: ["mcp-factory-485906", "distribute-488803"] },
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
  {
    provider: "twilio",
    ledgerVendors: ["twilio com"],
    ledgerVendorPrefix: null,
    excludedLedgerVendors: [],
    meteredSpend: { kind: "twilio-usage", account: "Distribute.you", meteredCategories: ["calls", "sms", "mms", "channels"], rentalCategories: ["phonenumbers"] },
  },
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
