import { describe, it, expect } from "vitest";
import { SEED_COSTS } from "../../src/db/seed.js";

describe("Instantly seed costs", () => {
  it("should include instantly-campaign-create at 0 cents", () => {
    const cost = SEED_COSTS.find((c) => c.name === "instantly-campaign-create");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.0000000000");
  });

  it("should include instantly-email-send at 0.94 cents", () => {
    const cost = SEED_COSTS.find((c) => c.name === "instantly-email-send");
    expect(cost).toBeDefined();
    expect(cost!.costPerUnitInUsdCents).toBe("0.9400000000");
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
