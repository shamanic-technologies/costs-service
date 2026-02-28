import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_PLANS } from "../../src/db/seed.js";

describe("Instantly seed costs", () => {
  it("should include instantly-email-send at 0.94 cents on growth/monthly", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "instantly-email-send");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.9400000000");
    expect(cost!.provider).toBe("instantly");
    expect(cost!.planTier).toBe("growth");
    expect(cost!.billingCycle).toBe("monthly");
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
  it("should include anthropic-opus-4-6-input-token at 0.0005 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-opus-4-6-input-token");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0005000000");
  });

  it("should include anthropic-opus-4-6-output-token at 0.0025 cents", () => {
    const cost = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-opus-4-6-output-token");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0025000000");
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

describe("Seed platform plans", () => {
  it("has a platform plan for every unique provider in seed costs", () => {
    const costProviders = new Set(SEED_PROVIDERS_COSTS.map((c) => c.provider));
    const planProviders = new Set(SEED_PLATFORM_PLANS.map((p) => p.provider));

    for (const provider of costProviders) {
      expect(planProviders.has(provider), `Missing platform plan for provider '${provider}'`).toBe(true);
    }
  });

  it("each platform plan matches a cost's plan tier and billing cycle", () => {
    for (const plan of SEED_PLATFORM_PLANS) {
      const matchingCost = SEED_PROVIDERS_COSTS.find(
        (c) => c.provider === plan.provider && c.planTier === plan.planTier && c.billingCycle === plan.billingCycle,
      );
      expect(matchingCost, `Platform plan for '${plan.provider}' (${plan.planTier}/${plan.billingCycle}) has no matching cost`).toBeDefined();
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
