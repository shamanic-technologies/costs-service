/**
 * The vendor SUBSCRIPTIONS whose real cost per credit staff read (`GET /internal/subscription-costs`,
 * formula in `src/lib/subscription-cost.ts`). Declared here, in the service that owns the figure,
 * so the owner reviews ONE list and no consumer keeps its own. Pay-as-you-go vendors (Anthropic,
 * Google Cloud, Twilio, DeepSeek...) are not subscriptions and are not listed.
 *
 * - `ledgerVendors`: bank-ledger vendor keys byte-equal (`GET /api/v1/vendors` on
 *   admin.kevinlourd.com). A key the ledger never paid is a 404 there, so a typo fails the refresh
 *   loud instead of reading as "we paid nothing". An EMPTY list = no ledger line found: the
 *   subscription is served as unmatched (money null), never as $0 paid.
 * - `creditCostNames`: the runs-service cost names whose quantities ARE the subscription's credits.
 * - `excludedCostNames`: names of the same vendor that are deliberately NOT credits, with the reason.
 *   Their consumption is still read and served beside, so the exclusion is visible.
 * - `orgKeyRows`: runs-service tags each unit with the key it went through (`platform` = ours,
 *   `org` = the customer's own). Only `platform` units are credits of OUR subscription, unless the
 *   provider's `org` units are proven to have gone through our account: then `count` + the evidence.
 *
 * Owner-approved 2026-10-01.
 */
export type Subscription = {
  key: string;
  label: string;
  /** Catalogue provider (`providers_costs.provider`). */
  provider: string;
  ledgerVendors: readonly string[];
  /** Why the ledger list is what it is, when it is not the obvious single line. */
  ledgerNote: string | null;
  creditDefinition: string;
  creditCostNames: readonly string[];
  excludedCostNames: readonly { costName: string; reason: string }[];
  orgKeyRows: { count: false } | { count: true; reason: string };
};

const NOT_OURS = { count: false } as const;

export const SUBSCRIPTIONS_SINCE = "2026-01-01";

export const SUBSCRIPTIONS: readonly Subscription[] = [
  {
    key: "apollo",
    label: "Apollo",
    provider: "apollo",
    ledgerVendors: ["apollo io"],
    ledgerNote: null,
    creditDefinition: "One Apollo credit: a person or company enrichment, or a person match",
    creditCostNames: ["apollo-credit", "apollo-enrichment-credit", "apollo-person-match-credit"],
    excludedCostNames: [{ costName: "apollo-search-credit", reason: "Apollo does not deduct credits for search" }],
    orgKeyRows: NOT_OURS,
  },
  {
    key: "scrape-do",
    label: "Scrape.do",
    provider: "scrape-do",
    ledgerVendors: ["scrape do scrape"],
    ledgerNote: null,
    creditDefinition: "One Scrape.do request recorded by our runs, whatever its kind (plain, scrape, render, super render)",
    creditCostNames: ["scrape-do-credit", "scrape-do-scrape-credit", "scrape-do-render-credit", "scrape-do-render-super-credit"],
    excludedCostNames: [],
    orgKeyRows: NOT_OURS,
  },
  {
    key: "firecrawl",
    label: "Firecrawl",
    provider: "firecrawl",
    ledgerVendors: ["firecrawl dev"],
    ledgerNote: null,
    creditDefinition: "One Firecrawl credit: a page scraped or a map call",
    creditCostNames: ["firecrawl-scrape-credit", "firecrawl-map-credit"],
    excludedCostNames: [{ costName: "firecrawl-extract-token", reason: "Extract is metered in tokens, another unit than credits" }],
    orgKeyRows: NOT_OURS,
  },
  {
    key: "apify",
    label: "Apify",
    provider: "apify",
    ledgerVendors: ["apify inv", "apify subscription"],
    ledgerNote: "Apify bills both as a subscription and as invoices: both ledger lines are Apify spend",
    creditDefinition:
      "One Apify result, whatever the actor: MIXED kinds (Ahrefs rows, leads, verified emails) counted one each, so the figure is an average over unlike units",
    creditCostNames: [
      "apify-ahrefs-result",
      "apify-pipelinelabs-lead",
      "apify-microworlds-lead",
      "apify-clearpath-lead",
      "apify-bounceverify-email",
    ],
    excludedCostNames: [{ costName: "apify-pipelinelabs-actor-start", reason: "An actor run start, not a result" }],
    orgKeyRows: {
      count: true,
      reason:
        "key-service holds no customer key for apify, only our platform key (checked 2026-10-01): units runs-service tags 'org' went through our account",
    },
  },
  {
    key: "postmark",
    label: "Postmark",
    provider: "postmark",
    ledgerVendors: ["postmarkapp com"],
    ledgerNote: null,
    creditDefinition: "One transactional email sent",
    creditCostNames: ["postmark-email-send"],
    excludedCostNames: [],
    orgKeyRows: NOT_OURS,
  },
  {
    key: "serper",
    label: "Serper",
    provider: "serper-dev",
    ledgerVendors: ["paddle net serper"],
    ledgerNote: "Serper is billed through its reseller Paddle",
    creditDefinition: "One Serper query",
    creditCostNames: ["serper-dev-query", "serper-dev-search-query"],
    excludedCostNames: [],
    orgKeyRows: {
      count: true,
      reason:
        "runs-service tags every Serper query 'org', but key-service holds no customer key for serper-dev, only our platform key (checked 2026-10-01): they went through our account",
    },
  },
  {
    key: "featured",
    label: "Featured",
    provider: "featured",
    ledgerVendors: ["featured terkel"],
    ledgerNote: null,
    creditDefinition: "One pitch submitted",
    creditCostNames: ["featured-api-pitch-submit"],
    excludedCostNames: [],
    orgKeyRows: NOT_OURS,
  },
  {
    key: "hunter",
    label: "Hunter",
    provider: "hunter",
    ledgerVendors: ["hunter io starter"],
    ledgerNote: null,
    creditDefinition: "One Hunter credit (no cost name records Hunter usage yet)",
    creditCostNames: [],
    excludedCostNames: [],
    orgKeyRows: NOT_OURS,
  },
  {
    key: "explee",
    label: "Explee",
    provider: "explee",
    ledgerVendors: [],
    ledgerNote: "No Explee line found in the bank ledger: what we paid is unknown, not zero",
    creditDefinition: "One Explee credit",
    creditCostNames: ["explee-credit"],
    excludedCostNames: [],
    orgKeyRows: NOT_OURS,
  },
];

/** Every cost name read from runs-service: credits and the excluded names served beside them. */
export function allSubscriptionCostNames(subs: readonly Subscription[] = SUBSCRIPTIONS): string[] {
  return [...new Set(subs.flatMap((s) => [...s.creditCostNames, ...s.excludedCostNames.map((e) => e.costName)]))];
}

export function allSubscriptionLedgerVendors(subs: readonly Subscription[] = SUBSCRIPTIONS): string[] {
  return [...new Set(subs.flatMap((s) => s.ledgerVendors))];
}

/** Whether units through this key source are credits of OUR subscription. */
export function isCountedSource(sub: Subscription, source: "platform" | "org"): boolean {
  return source === "platform" || sub.orgKeyRows.count;
}
