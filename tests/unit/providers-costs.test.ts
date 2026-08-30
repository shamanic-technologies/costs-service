import { describe, it, expect } from "vitest";
import {
  applyCostRiskMultiplier,
  COST_RISK_MULTIPLIER,
  COST_PROFIT_MULTIPLIER,
  COST_DEFAULT_MULTIPLIER,
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
} from "../../src/db/seed.js";

describe("Cost risk multiplier", () => {
  it("applies the default 6x multiplier (risk × profit) to seed costs with fixed decimal precision", () => {
    expect(COST_RISK_MULTIPLIER).toBe(2);
    expect(COST_PROFIT_MULTIPLIER).toBe(3);
    expect(COST_DEFAULT_MULTIPLIER).toBe(6); // risk × profit
    expect(applyCostRiskMultiplier("0.0000000000")).toBe("0.0000000000");
    expect(applyCostRiskMultiplier("1.3300000000")).toBe("7.9800000000");
  });

  it("applies a per-cost override multiplier (1.2x) exactly to 10 decimals", () => {
    expect(applyCostRiskMultiplier("2.3600000000", 1.2)).toBe("2.8320000000");
    expect(applyCostRiskMultiplier("0.0002000000", 1.2)).toBe("0.0002400000");
    expect(applyCostRiskMultiplier("0.0012000000", 1.2)).toBe("0.0014400000");
    // multiplier 1 is identity
    expect(applyCostRiskMultiplier("1.2300000000", 1)).toBe("1.2300000000");
  });

  it("rejects an invalid multiplier", () => {
    expect(() => applyCostRiskMultiplier("1.0000000000", -1)).toThrow();
    expect(() => applyCostRiskMultiplier("1.0000000000", NaN)).toThrow();
  });
});

describe("Instantly seed costs (cold-email infra — delisted, no billable price)", () => {
  const COLD_EMAIL_NAMES = [
    "instantly-contact-uploaded",
    "instantly-account-email-sent",
    "instantly-domain-email-sent",
  ];

  // The cold-email infrastructure spend moved onto our own fixed costs, so these three names
  // stopped being rebilled. Every one of their seed entries carries a null price: the name is
  // KEPT (spend already declared against it must stay readable) and is never re-priced to zero
  // (a zero would claim the line is free — we still pay for the inboxes).
  it.each(COLD_EMAIL_NAMES)("%s carries no billable price on any tier", (name) => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).toBeNull();
      expect(row.provider).toBe("instantly");
    }
  });

  it("keeps both instantly tiers declared so no plan can resurrect a price", () => {
    const tiers = SEED_PROVIDERS_COSTS.filter((c) => c.name === "instantly-contact-uploaded").map(
      (c) => c.planTier
    );
    expect(tiers.sort()).toEqual(["growth", "hypergrowth"]);
  });

  // The `instantly` platform row stays: with no active plan for the provider, every by-name
  // read of these names would 500 instead of resolving for historical spend.
  it("should not contain legacy instantly-email-send", () => {
    const legacy = SEED_PROVIDERS_COSTS.find((c) => c.name === "instantly-email-send");
    expect(legacy, "legacy instantly-email-send should not exist in seed").toBeUndefined();
  });

  it("platform cost for instantly should be hypergrowth/monthly", () => {
    const pc = SEED_PLATFORM_COSTS.find((p) => p.provider === "instantly");
    expect(pc).toBeDefined();
    expect(pc!.planTier).toBe("hypergrowth");
    expect(pc!.billingCycle).toBe("monthly");
  });
});

describe("Twilio seed costs", () => {
  it("should include twilio-sms-segment at 7.98 cents on pay-as-you-go/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "twilio-sms-segment");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("7.9800000000");
    expect(cost!.provider).toBe("twilio");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include twilio-whatsapp-message at 3 cents on pay-as-you-go/monthly (WhatsApp channel)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "twilio-whatsapp-message");
    expect(cost).toBeDefined();
    // raw 0.5¢ (US all-in per-message, Marketing category) × 6 default markup = 3¢
    expect(cost!.costPerUnitInUsdCents).toBe("3.0000000000");
    expect(cost!.provider).toBe("twilio");
    expect(cost!.type).toBe("WhatsApp message");
    expect(cost!.unit).toBe("message");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("twilio-whatsapp-message resolves against the active twilio platform cost (tier/cycle byte-equal)", () => {
    // Guard: platform-prices joins providers_costs → active platform_costs on
    // (planTier, billingCycle). If they diverge, a producer declaring the cost 422/404s.
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "twilio-whatsapp-message");
    const platform = SEED_PLATFORM_COSTS.find((p) => p.provider === "twilio");
    expect(cost).toBeDefined();
    expect(platform).toBeDefined();
    expect(cost!.planTier).toBe(platform!.planTier);
    expect(cost!.billingCycle).toBe(platform!.billingCycle);
  });
});

describe("Featured seed costs", () => {
  it("should only bill pitch submissions at 0.3 cents on pay-as-you-go/monthly", () => {
    const pitchSubmit = SEED_PROVIDERS_COSTS.find((c) => c.name === "featured-api-pitch-submit");
    const opportunityFetch = SEED_PROVIDERS_COSTS.find((c) => c.name === "featured-api-opportunity-fetch");

    expect(opportunityFetch, "opportunity fetches are free/unlimited and should not be seeded").toBeUndefined();
    expect(pitchSubmit).toBeDefined();
    // $1/2000 ($0.0005 = 0.05¢) base unit × 6 default markup = 0.25¢.
    expect(pitchSubmit!.costPerUnitInUsdCents).toBe("0.3000000000");
    expect(pitchSubmit!.provider).toBe("featured");
    expect(pitchSubmit!.providerDomain).toBe("featured.com");
    expect(pitchSubmit!.type).toBe("API call (pitch submit)");
    expect(pitchSubmit!.unit).toBe("call");
    expect(pitchSubmit!.planTier).toBe("pay-as-you-go");
    expect(pitchSubmit!.billingCycle).toBe("monthly");
  });

  it("platform cost for featured should be pay-as-you-go/monthly", () => {
    const pc = SEED_PLATFORM_COSTS.find((p) => p.provider === "featured");
    expect(pc).toBeDefined();
    expect(pc!.planTier).toBe("pay-as-you-go");
    expect(pc!.billingCycle).toBe("monthly");
  });
});

describe("Anthropic Sonnet 4.6 seed costs", () => {
  it("should include anthropic-sonnet-4.6-tokens-input at 0.0018 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-sonnet-4.6-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0018000000");
    expect(cost!.provider).toBe("anthropic");
    expect(cost!.planTier).toBe("pay-as-you-go");
  });

  it("should include anthropic-sonnet-4.6-tokens-output at 0.009 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-sonnet-4.6-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0090000000");
  });
});

describe("Anthropic Opus 4.6 seed costs", () => {
  it("should include anthropic-opus-4.6-tokens-input at 0.003 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-opus-4.6-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0030000000");
  });

  it("should include anthropic-opus-4.6-tokens-output at 0.015 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-opus-4.6-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0150000000");
  });

  it("should not contain legacy opus naming (anthropic-opus-4-6-*-token)", () => {
    const legacy = SEED_PROVIDERS_COSTS.filter((c) => c.name.startsWith("anthropic-opus-4-6-"));
    expect(legacy, "legacy anthropic-opus-4-6-* names should not exist").toHaveLength(0);
  });
});

describe("Apollo seed costs", () => {
  it("should include unified apollo-credit at 14.16 cents (Basic $59/mo ÷ 2,500 credits × 6 markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "apollo-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("14.1600000000");
    expect(cost!.provider).toBe("apollo");
    expect(cost!.planTier).toBe("basic");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should not have legacy apollo-enrichment-credit or apollo-person-match-credit entries", () => {
    const legacy = SEED_PROVIDERS_COSTS.filter(
      (c) => c.name === "apollo-enrichment-credit" || c.name === "apollo-person-match-credit" || c.name === "apollo-search-credit"
    );
    expect(legacy).toHaveLength(0);
  });
});

describe("Google Flash Lite 3.1 seed costs", () => {
  it("should include google-flash-lite-3.1-tokens-input at 0.00015 cents ($0.25/MTok x markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-lite-3.1-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0001500000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-flash-lite-3.1-tokens-output at 0.0009 cents ($1.50/MTok x markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-lite-3.1-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0009000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Pro 3.1 seed costs", () => {
  it("should include google-pro-3.1-tokens-input at 0.0012 cents ($2.00/MTok, <=200k context × 6 markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-3.1-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0012000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-pro-3.1-tokens-output at 0.0072 cents ($12.00/MTok, <=200k context × 6 markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-3.1-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0072000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Pro 2.5 seed costs", () => {
  it("should include google-pro-2.5-tokens-input at 0.00075 cents ($1.25/MTok, <=200k context x markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-2.5-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0007500000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-pro-2.5-tokens-output at 0.006 cents ($10.00/MTok, <=200k context x markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-2.5-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0060000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Flash 2.5 seed costs", () => {
  it("should include google-flash-2.5-tokens-input at 0.00018 cents ($0.30/MTok x markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-2.5-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0001800000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-flash-2.5-tokens-output at 0.0015 cents ($2.50/MTok x markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-2.5-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0015000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Flash-Lite 2.5 seed costs", () => {
  it("should include google-flash-lite-2.5-tokens-input at 0.00006 cents ($0.10/MTok x markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-lite-2.5-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0000600000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-flash-lite-2.5-tokens-output at 0.00024 cents ($0.40/MTok x markup)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-lite-2.5-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0002400000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Search seed costs", () => {
  it("should include google-search-query at 8.4 cents on pay-as-you-go/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-search-query");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("8.4000000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Firecrawl extract seed costs", () => {
  it("should include firecrawl-extract-token at 0.2533333332 cents on hobby/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "firecrawl-extract-token");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.2533333332");
    expect(cost!.provider).toBe("firecrawl");
    expect(cost!.planTier).toBe("hobby");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Scrape.do seed costs", () => {
  it("should include scrape-do-credit at 0.0696 cents on hobby/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "scrape-do-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0696000000");
    expect(cost!.provider).toBe("scrape-do");
    expect(cost!.planTier).toBe("hobby");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should have exactly one scrape-do cost (unified as scrape-do-credit)", () => {
    const scrapeDoCosts = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "scrape-do");
    expect(scrapeDoCosts).toHaveLength(1);
    expect(scrapeDoCosts[0].name).toBe("scrape-do-credit");
  });

  it("should not contain legacy scrape-do cost names", () => {
    const legacyNames = [
      "scrape-do-scrape-credit",
      "scrape-do-render-credit",
      "scrape-do-render-super-credit",
    ];
    for (const name of legacyNames) {
      const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === name);
      expect(cost, `legacy cost '${name}' should not exist in seed`).toBeUndefined();
    }
  });
});

describe("Serper seed costs", () => {
  it("should include serper-dev-query at 0.6 cents on pay-as-you-go/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "serper-dev-query");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.6000000000");
    expect(cost!.provider).toBe("serper-dev");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should have exactly one serper cost (unified as serper-dev-query)", () => {
    const serperCosts = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "serper-dev");
    expect(serperCosts).toHaveLength(1);
    expect(serperCosts[0].name).toBe("serper-dev-query");
  });

  it("should not contain legacy serper cost names", () => {
    const legacyNames = [
      "serper-dev-search-query",
      "serper-dev-search-web-query",
      "serper-dev-search-news-query",
      "serper-search-credit",
    ];
    for (const name of legacyNames) {
      const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === name);
      expect(cost, `legacy cost '${name}' should not exist in seed`).toBeUndefined();
    }
  });
});

describe("Google seed costs — no legacy gemini names", () => {
  it("should not contain any cost names starting with 'gemini-'", () => {
    const legacyNames = SEED_PROVIDERS_COSTS.filter((c) => c.name.startsWith("gemini-"));
    expect(legacyNames, "legacy gemini-* cost names should not exist in seed").toHaveLength(0);
  });

  it("should not contain any provider values set to 'gemini'", () => {
    const legacyProviders = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "gemini");
    expect(legacyProviders, "legacy gemini provider should not exist in seed").toHaveLength(0);
  });
});

describe("All seed costs have required plan fields", () => {
  it("every seed cost has provider, planTier, and billingCycle", () => {
    for (const cost of SEED_PROVIDERS_COSTS) {
      expect(cost.provider, `${cost.name} missing provider`).toBeDefined();
      expect(cost.provider.length, `${cost.name} has empty provider`).toBeGreaterThan(0);
      expect(cost.planTier, `${cost.name} missing planTier`).toBeDefined();
      expect(cost.planTier.length, `${cost.name} has empty planTier`).toBeGreaterThan(0);
      expect(cost.billingCycle, `${cost.name} missing billingCycle`).toBeDefined();
      expect(cost.billingCycle.length, `${cost.name} has empty billingCycle`).toBeGreaterThan(0);
    }
  });
});

describe("Seed platform costs", () => {
  it("has a platform cost for every unique provider in seed costs", () => {
    const costProviders = new Set(SEED_PROVIDERS_COSTS.map((c) => c.provider));
    const platformCostProviders = new Set(SEED_PLATFORM_COSTS.map((p) => p.provider));

    for (const provider of costProviders) {
      expect(platformCostProviders.has(provider), `Missing platform cost for provider '${provider}'`).toBe(true);
    }
  });

  it("each platform cost matches a provider cost's plan tier and billing cycle", () => {
    for (const pc of SEED_PLATFORM_COSTS) {
      // A provider with no priced rows at all is inert, not broken. The invariant that
      // matters is the tier match — a provider that HAS rows on a different tier 404s at
      // read time. (`vercel` used to sit in the no-rows state; it is now retired from the
      // seed outright — see deepseek-v4-flash-costs.test.ts.)
      const providerCosts = SEED_PROVIDERS_COSTS.filter((c) => c.provider === pc.provider);
      if (providerCosts.length === 0) continue;
      const matchingCost = SEED_PROVIDERS_COSTS.find(
        (c) => c.provider === pc.provider && c.planTier === pc.planTier && c.billingCycle === pc.billingCycle,
      );
      expect(matchingCost, `Platform cost for '${pc.provider}' (${pc.planTier}/${pc.billingCycle}) has no matching provider cost`).toBeDefined();
    }
  });
});

describe("Cost resolution logic", () => {
  it("should pick the latest effective price from a list", () => {
    const costs = [
      { name: "test", provider: "t", planTier: "basic", billingCycle: "monthly", costPerUnitInUsdCents: "0.10", effectiveFrom: new Date("2025-01-01") },
      { name: "test", provider: "t", planTier: "basic", billingCycle: "monthly", costPerUnitInUsdCents: "0.20", effectiveFrom: new Date("2025-06-01") },
      { name: "test", provider: "t", planTier: "basic", billingCycle: "monthly", costPerUnitInUsdCents: "0.30", effectiveFrom: new Date("2025-09-01") },
    ];

    const now = new Date("2025-08-01");
    const applicable = costs
      .filter((c) => c.effectiveFrom <= now)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

    expect(applicable[0].costPerUnitInUsdCents).toBe("0.20");
  });

  it("should return no results if all prices are in the future", () => {
    const costs = [
      { name: "test", provider: "t", planTier: "basic", billingCycle: "monthly", costPerUnitInUsdCents: "0.10", effectiveFrom: new Date("2030-01-01") },
    ];

    const now = new Date("2025-01-01");
    const applicable = costs.filter((c) => c.effectiveFrom <= now);

    expect(applicable).toHaveLength(0);
  });

  it("should handle a single price point", () => {
    const costs = [
      { name: "test", provider: "t", planTier: "basic", billingCycle: "monthly", costPerUnitInUsdCents: "0.05", effectiveFrom: new Date("2024-01-01") },
    ];

    const now = new Date("2025-01-01");
    const applicable = costs
      .filter((c) => c.effectiveFrom <= now)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

    expect(applicable[0].costPerUnitInUsdCents).toBe("0.05");
  });

  it("should deduplicate current prices per name (same plan)", () => {
    const allCosts = [
      { name: "alpha", provider: "a", planTier: "basic", billingCycle: "monthly", costPerUnitInUsdCents: "0.10", effectiveFrom: new Date("2025-06-01") },
      { name: "alpha", provider: "a", planTier: "basic", billingCycle: "monthly", costPerUnitInUsdCents: "0.05", effectiveFrom: new Date("2025-01-01") },
      { name: "beta", provider: "b", planTier: "growth", billingCycle: "monthly", costPerUnitInUsdCents: "1.00", effectiveFrom: new Date("2025-03-01") },
      { name: "beta", provider: "b", planTier: "growth", billingCycle: "monthly", costPerUnitInUsdCents: "0.80", effectiveFrom: new Date("2025-01-01") },
    ];

    // Simulate platform plan resolution
    const planMap = new Map([
      ["a", { planTier: "basic", billingCycle: "monthly" }],
      ["b", { planTier: "growth", billingCycle: "monthly" }],
    ]);

    const sorted = allCosts.sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    });

    const seen = new Set<string>();
    const current = sorted.filter((row) => {
      if (seen.has(row.name)) return false;
      const plan = planMap.get(row.provider);
      if (!plan) return false;
      if (row.planTier !== plan.planTier || row.billingCycle !== plan.billingCycle) return false;
      seen.add(row.name);
      return true;
    });

    expect(current).toHaveLength(2);
    expect(current[0].name).toBe("alpha");
    expect(current[0].costPerUnitInUsdCents).toBe("0.10");
    expect(current[1].name).toBe("beta");
    expect(current[1].costPerUnitInUsdCents).toBe("1.00");
  });
});
