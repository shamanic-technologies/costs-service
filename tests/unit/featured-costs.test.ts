import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Featured.com pitch submit unit cost", () => {
  it("prices featured-api-pitch-submit at the highest PAYG unit ($6.99/credit, pay-as-you-go)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "featured-api-pitch-submit");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("featured");
    expect(row!.providerDomain).toBe("featured.com");
    expect(row!.type).toBe("API call (pitch submit)");
    expect(row!.unit).toBe("call");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    // $6.99/credit = 699¢ pre-multiplier (highest Pay-as-you-go unit, the 1-credit pack);
    // stored value is 2× (cost-risk markup) => 1398¢.
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("699.0000000000"));
    expect(row!.costPerUnitInUsdCents).toBe("1398.0000000000");
  });

  it("resolves against the active featured platform cost (plan_tier + billing_cycle match)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "featured-api-pitch-submit")!;
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "featured");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // If the platform row stays on the old "premium" tier while the provider row moves to
    // "pay-as-you-go", GET /v1/platform-prices/featured-api-pitch-submit 404s "No price found".
    expect(row.planTier).toBe(platform!.planTier);
    expect(row.billingCycle).toBe(platform!.billingCycle);
  });
});
