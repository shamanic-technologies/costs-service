import { describe, it, expect } from "vitest";
import { SEED_COSTS } from "../../src/db/seed.js";

describe("Instantly seed costs", () => {
  it("should include instantly-email-send at 0.94 cents", () => {
    const cost = SEED_COSTS.find((c) => c.name === "instantly-email-send");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.9400000000");
  });
});

describe("Twilio seed costs", () => {
  it("should include twilio-sms-segment at 1.33 cents", () => {
    const cost = SEED_COSTS.find((c) => c.name === "twilio-sms-segment");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("1.3300000000");
  });
});

describe("Anthropic Sonnet 4.6 seed costs", () => {
  it("should include anthropic-sonnet-4.6-tokens-input at 0.0003 cents", () => {
    const cost = SEED_COSTS.find((c) => c.name === "anthropic-sonnet-4.6-tokens-input");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0003000000");
  });

  it("should include anthropic-sonnet-4.6-tokens-output at 0.0015 cents", () => {
    const cost = SEED_COSTS.find((c) => c.name === "anthropic-sonnet-4.6-tokens-output");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0015000000");
  });
});

describe("Anthropic Opus 4.6 seed costs", () => {
  it("should include anthropic-opus-4-6-input-token at 0.0005 cents", () => {
    const cost = SEED_COSTS.find((c) => c.name === "anthropic-opus-4-6-input-token");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0005000000");
  });

  it("should include anthropic-opus-4-6-output-token at 0.0025 cents", () => {
    const cost = SEED_COSTS.find((c) => c.name === "anthropic-opus-4-6-output-token");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0025000000");
  });
});

describe("Apollo seed costs", () => {
  it("should include apollo-enrichment-credit at 2.36 cents ($59/mo ÷ 2,500 credits)", () => {
    const cost = SEED_COSTS.find((c) => c.name === "apollo-enrichment-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("2.3600000000");
  });

  it("should include apollo-person-match-credit at 2.36 cents (same credit type as enrichment)", () => {
    const cost = SEED_COSTS.find((c) => c.name === "apollo-person-match-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("2.3600000000");
  });

  it("should include apollo-search-credit at 0.00 cents (free)", () => {
    const cost = SEED_COSTS.find((c) => c.name === "apollo-search-credit");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0000000000");
  });
});

describe("Cost resolution logic", () => {
  it("should pick the latest effective price from a list", () => {
    const costs = [
      { name: "test", costPerUnitInUsdCents: "0.10", effectiveFrom: new Date("2025-01-01") },
      { name: "test", costPerUnitInUsdCents: "0.20", effectiveFrom: new Date("2025-06-01") },
      { name: "test", costPerUnitInUsdCents: "0.30", effectiveFrom: new Date("2025-09-01") },
    ];

    const now = new Date("2025-08-01");
    const applicable = costs
      .filter((c) => c.effectiveFrom <= now)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

    expect(applicable[0].costPerUnitInUsdCents).toBe("0.20");
  });

  it("should return no results if all prices are in the future", () => {
    const costs = [
      { name: "test", costPerUnitInUsdCents: "0.10", effectiveFrom: new Date("2030-01-01") },
    ];

    const now = new Date("2025-01-01");
    const applicable = costs.filter((c) => c.effectiveFrom <= now);

    expect(applicable).toHaveLength(0);
  });

  it("should handle a single price point", () => {
    const costs = [
      { name: "test", costPerUnitInUsdCents: "0.05", effectiveFrom: new Date("2024-01-01") },
    ];

    const now = new Date("2025-01-01");
    const applicable = costs
      .filter((c) => c.effectiveFrom <= now)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

    expect(applicable[0].costPerUnitInUsdCents).toBe("0.05");
  });

  it("should deduplicate current prices per name", () => {
    const allCosts = [
      { name: "alpha", costPerUnitInUsdCents: "0.10", effectiveFrom: new Date("2025-06-01") },
      { name: "alpha", costPerUnitInUsdCents: "0.05", effectiveFrom: new Date("2025-01-01") },
      { name: "beta", costPerUnitInUsdCents: "1.00", effectiveFrom: new Date("2025-03-01") },
      { name: "beta", costPerUnitInUsdCents: "0.80", effectiveFrom: new Date("2025-01-01") },
    ];

    // Sorted by name then desc effectiveFrom (like the DB query)
    const sorted = allCosts.sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    });

    const seen = new Set<string>();
    const current = sorted.filter((row) => {
      if (seen.has(row.name)) return false;
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
