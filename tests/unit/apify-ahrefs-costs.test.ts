import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Apify Ahrefs scrape unit cost", () => {
  it("registers apify-ahrefs-result at $0.005/result (Bronze tier, Starter plan)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "apify-ahrefs-result");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("apify");
    expect(row!.providerDomain).toBe("apify.com");
    expect(row!.type).toBe("Ahrefs scrape result");
    expect(row!.unit).toBe("result");
    expect(row!.planTier).toBe("starter");
    expect(row!.billingCycle).toBe("monthly");
    // $0.005 = 0.5¢ pre-multiplier; stored value is 4× (risk × profit markup) = 2¢.
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.5000000000"));
  });

  it("resolves against the active apify platform cost (plan_tier + billing_cycle match)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "apify-ahrefs-result")!;
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "apify");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // Without the apify platform cost, GET /v1/platform-prices/apify-ahrefs-result returns
    // 500 "No platform cost configured for provider 'apify'" — never a price.
    expect(row.planTier).toBe(platform!.planTier);
    expect(row.billingCycle).toBe(platform!.billingCycle);
  });
});
