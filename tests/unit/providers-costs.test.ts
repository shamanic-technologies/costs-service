import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS } from "../../src/db/seed.js";

describe("Instantly seed costs", () => {
  it("should include instantly-contact-uploaded at 4.70 cents on growth/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "instantly-contact-uploaded" && c.planTier === "growth");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("4.7000000000");
    expect(cost!.provider).toBe("instantly");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include instantly-account-email-sent at 1.6667 cents on growth/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "instantly-account-email-sent" && c.planTier === "growth");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("1.6667000000");
    expect(cost!.provider).toBe("instantly");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include instantly-domain-email-sent at 0.1984 cents on growth/yearly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "instantly-domain-email-sent" && c.planTier === "growth");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.1984000000");
    expect(cost!.provider).toBe("instantly");
    expect(cost!.billingCycle).toBe("yearly");
  });

  it("should include hypergrowth tier for instantly-contact-uploaded at 0.388 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "instantly-contact-uploaded" && c.planTier === "hypergrowth");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.3880000000");
    expect(cost!.billingCycle).toBe("monthly");
  });

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
  it("should include twilio-sms-segment at 1.33 cents on pay-as-you-go/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "twilio-sms-segment");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("1.3300000000");
    expect(cost!.provider).toBe("twilio");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Anthropic Sonnet 4.6 seed costs", () => {
  it("should include anthropic-sonnet-4.6-tokens-input at 0.0003 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-sonnet-4.6-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0003000000");
    expect(cost!.provider).toBe("anthropic");
    expect(cost!.planTier).toBe("pay-as-you-go");
  });

  it("should include anthropic-sonnet-4.6-tokens-output at 0.0015 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-sonnet-4.6-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0015000000");
  });
});

describe("Anthropic Opus 4.6 seed costs", () => {
  it("should include anthropic-opus-4.6-tokens-input at 0.0005 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-opus-4.6-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0005000000");
  });

  it("should include anthropic-opus-4.6-tokens-output at 0.0025 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-opus-4.6-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0025000000");
  });

  it("should not contain legacy opus naming (anthropic-opus-4-6-*-token)", () => {
    const legacy = SEED_PROVIDERS_COSTS.filter((c) => c.name.startsWith("anthropic-opus-4-6-"));
    expect(legacy, "legacy anthropic-opus-4-6-* names should not exist").toHaveLength(0);
  });
});

describe("Apollo seed costs", () => {
  it("should include apollo-enrichment-credit at 2.36 cents (Basic $59/mo ÷ 2,500 credits)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "apollo-enrichment-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("2.3600000000");
    expect(cost!.provider).toBe("apollo");
    expect(cost!.planTier).toBe("basic");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include apollo-person-match-credit at 2.36 cents (same credit type as enrichment)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "apollo-person-match-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("2.3600000000");
  });

  it("should include apollo-search-credit at 0.00 cents (free)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "apollo-search-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0000000000");
  });
});

describe("Google Flash Lite 3.1 seed costs", () => {
  it("should include google-flash-lite-3.1-tokens-input at 0.000025 cents ($0.25/MTok)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-lite-3.1-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0000250000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-flash-lite-3.1-tokens-output at 0.00015 cents ($1.50/MTok)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-lite-3.1-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0001500000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Pro 3.1 seed costs", () => {
  it("should include google-pro-3.1-tokens-input at 0.0002 cents ($2.00/MTok, ≤200k context)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-3.1-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0002000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-pro-3.1-tokens-output at 0.0012 cents ($12.00/MTok, ≤200k context)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-3.1-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0012000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Pro 2.5 seed costs", () => {
  it("should include google-pro-2.5-tokens-input at 0.000125 cents ($1.25/MTok, ≤200k context)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-2.5-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0001250000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-pro-2.5-tokens-output at 0.001 cents ($10.00/MTok, ≤200k context)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-2.5-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0010000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Flash 2.5 seed costs", () => {
  it("should include google-flash-2.5-tokens-input at 0.00003 cents ($0.30/MTok)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-2.5-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0000300000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-flash-2.5-tokens-output at 0.00025 cents ($2.50/MTok)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-2.5-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0002500000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Flash-Lite 2.5 seed costs", () => {
  it("should include google-flash-lite-2.5-tokens-input at 0.00001 cents ($0.10/MTok)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-lite-2.5-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0000100000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });

  it("should include google-flash-lite-2.5-tokens-output at 0.00004 cents ($0.40/MTok)", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-lite-2.5-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0000400000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Google Search seed costs", () => {
  it("should include google-search-query at 1.4 cents on pay-as-you-go/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-search-query");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("1.4000000000");
    expect(cost!.provider).toBe("google");
    expect(cost!.planTier).toBe("pay-as-you-go");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Firecrawl extract seed costs", () => {
  it("should include firecrawl-extract-token at 0.0422222222 cents on hobby/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "firecrawl-extract-token");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0422222222");
    expect(cost!.provider).toBe("firecrawl");
    expect(cost!.planTier).toBe("hobby");
    expect(cost!.billingCycle).toBe("monthly");
  });
});

describe("Scrape.do seed costs", () => {
  it("should include scrape-do-credit at 0.0116 cents on hobby/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "scrape-do-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0116000000");
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
  it("should include serper-dev-query at 0.1 cents on pay-as-you-go/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "serper-dev-query");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.1000000000");
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
