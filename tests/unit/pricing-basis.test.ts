import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  ADVERTISING_CHANNEL_COSTS,
  applyCostRiskMultiplier,
  passThroughVendorPrice,
  expectedSeedRowFloor,
  PROVIDER_DOMAINS,
} from "../../src/db/seed.js";

// The commercial promise this file guards: we take NO markup on what we ROUTE (advertising
// platform spend, payment processing fees), and we keep the markup on what we PERFORM (LLM
// tokens, embeddings, enrichment, search, creative generation). Both halves are asserted —
// a regression that quietly marks up a routed line and a regression that quietly drops the
// markup from work are equally bad, and only one of them is visible on a pricing page.

const PASS_THROUGH_PAYMENT_FEES = [
  "stripe-processing-fee",
  "stripe-refund-fee",
  "stripe-dispute-fee",
  "stripe-payout-failure-fee",
];

const ADVERTISING_CHANNEL_NAMES = [
  "google-ads-spend",
  "meta-ads-spend",
  "linkedin-ads-spend",
  "tiktok-ads-spend",
  "youtube-ads-spend",
  "x-ads-spend",
  "reddit-ads-spend",
  "bing-ads-spend",
  "quora-ads-spend",
  "newsletter-sponsorship-spend",
  "podcast-sponsorship-spend",
  "creator-sponsorship-spend",
  "software-directory-listing-spend",
];

describe("pricing basis", () => {
  it("every seed row states a class, and only the two known ones exist", () => {
    for (const cost of SEED_PROVIDERS_COSTS) {
      expect(["marked-up", "pass-through"], `${cost.name} basis`).toContain(cost.pricingBasis);
    }
  });

  it("the pass-through set is exactly the routed money — payment fees plus advertising channels", () => {
    const passThrough = SEED_PROVIDERS_COSTS.filter((c) => c.pricingBasis === "pass-through").map(
      (c) => c.name
    );
    expect([...new Set(passThrough)].sort()).toEqual(
      [...PASS_THROUGH_PAYMENT_FEES, ...ADVERTISING_CHANNEL_NAMES].sort()
    );
  });

  it("a pass-through line stores the vendor price untouched", () => {
    for (const cost of SEED_PROVIDERS_COSTS.filter((c) => c.pricingBasis === "pass-through")) {
      // One cent charged per cent of vendor spend: quantity IS the vendor amount in cents,
      // so the org pays the vendor amount exactly.
      expect(cost.costPerUnitInUsdCents, `${cost.name} price`).toBe("1.0000000000");
      expect(cost.unit, `${cost.name} unit`).toBe("USD cent");
      // And it is emphatically not the marked-up number those lines used to carry.
      expect(cost.costPerUnitInUsdCents).not.toBe(applyCostRiskMultiplier("1.0000000000"));
    }
  });

  it("work we perform keeps its markup — no line of ours became pass-through", () => {
    const WORK_PROVIDERS = [
      "anthropic",
      "google",
      "deepseek",
      "moonshot",
      "zai",
      "vercel",
      "apollo",
      "apify",
      "firecrawl",
      "serper-dev",
      "scrape-do",
      "instantly",
      "postmark",
      "twilio",
      "cloudflare",
      "featured",
    ];
    const work = SEED_PROVIDERS_COSTS.filter((c) => WORK_PROVIDERS.includes(c.provider));
    expect(work.length).toBeGreaterThan(50);
    for (const cost of work) {
      expect(cost.pricingBasis, `${cost.name} basis`).toBe("marked-up");
    }
  });

  it("a marked-up line is the vendor rate times the store multiplier (5x)", () => {
    const webSearch = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-web-search");
    expect(webSearch?.pricingBasis).toBe("marked-up");
    expect(webSearch?.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("1.0000000000"));
    // 5× = COST_RISK_MULTIPLIER 2 × COST_PROFIT_MULTIPLIER 2.5 (raised from 4× when the
    // cold-email lines stopped being rebilled; the markup carries the unit economics they did).
    expect(webSearch?.costPerUnitInUsdCents).toBe("5.0000000000");
  });

  it("passThroughVendorPrice returns its input and rejects a malformed one", () => {
    expect(passThroughVendorPrice("0.0123456789")).toBe("0.0123456789");
    expect(() => passThroughVendorPrice("0.01")).toThrow(/Invalid seed cost format/);
    expect(() => passThroughVendorPrice("abc")).toThrow(/Invalid seed cost format/);
  });
});

describe("advertising channels", () => {
  it("covers every channel we are about to sell through", () => {
    expect(ADVERTISING_CHANNEL_COSTS.map((c) => c.name).sort()).toEqual(
      [...ADVERTISING_CHANNEL_NAMES].sort()
    );
  });

  it("each channel is chargeable at zero markup and is in the catalog", () => {
    for (const name of ADVERTISING_CHANNEL_NAMES) {
      const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
      expect(rows.length, `${name} row count`).toBe(1);
      expect(rows[0].pricingBasis).toBe("pass-through");
      expect(rows[0].costPerUnitInUsdCents).toBe("1.0000000000");
    }
  });

  it("each channel resolves — its provider has an active platform row on the same plan", () => {
    // Without this, GET /v1/platform-prices/:name 500s ("No platform cost configured") or 404s
    // on a tier mismatch: a cost row alone never serves.
    for (const cost of ADVERTISING_CHANNEL_COSTS) {
      const platform = SEED_PLATFORM_COSTS.find((p) => p.provider === cost.provider);
      expect(platform, `platform cost for ${cost.provider}`).toBeDefined();
      expect(platform!.planTier).toBe(cost.planTier);
      expect(platform!.billingCycle).toBe(cost.billingCycle);
    }
  });

  it("the ad platforms carry a logo domain; sponsorships and directories have none", () => {
    const withDomain = ["google-ads", "meta-ads", "linkedin-ads", "tiktok-ads", "youtube-ads", "x-ads", "reddit-ads", "bing-ads", "quora-ads"];
    for (const provider of withDomain) {
      expect(PROVIDER_DOMAINS[provider], `${provider} domain`).toBeTruthy();
    }
    for (const provider of ["newsletter-sponsorship", "podcast-sponsorship", "creator-sponsorship", "software-directory-listing"]) {
      expect(PROVIDER_DOMAINS[provider]).toBeUndefined();
    }
  });
});

describe("seed row-count floor", () => {
  it("counts the rows a fresh seed writes, not the entries it declares", () => {
    // A name with two in-force versions writes ONE row (the newest); a version dated in the
    // future writes its own row at its own date. Counting ENTRIES made the startup verify fail
    // the day a scheduled price came into force — DeepSeek's time-of-day rates, 2026-08-16 —
    // which is precisely when nothing was wrong.
    const now = new Date();
    const inForceKeys = new Set(
      SEED_PROVIDERS_COSTS.filter((c) => c.effectiveFrom <= now).map(
        (c) => `${c.name}|${c.planTier}|${c.billingCycle}`
      )
    );
    const scheduled = SEED_PROVIDERS_COSTS.filter((c) => c.effectiveFrom > now).length;

    expect(expectedSeedRowFloor(now)).toBe(inForceKeys.size + scheduled);
    expect(expectedSeedRowFloor(now)).toBeLessThanOrEqual(SEED_PROVIDERS_COSTS.length);
  });

  it("a scheduled version counts on its own until it comes into force, then supersedes", () => {
    // One instant apart across DeepSeek's schedule, same catalog.
    expect(expectedSeedRowFloor(new Date("2026-08-16T15:59:00Z"))).toBeGreaterThan(
      expectedSeedRowFloor(new Date("2026-08-16T16:01:00Z"))
    );
  });
});
