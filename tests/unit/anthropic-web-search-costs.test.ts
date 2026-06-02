import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Anthropic web search unit cost", () => {
  it("registers anthropic-web-search at $10/1,000 searches = 1.0c/search", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-web-search");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("anthropic");
    expect(row!.providerDomain).toBe("anthropic.com");
    expect(row!.type).toBe("Web search");
    expect(row!.unit).toBe("search");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("1.0000000000"));
  });

  it("resolves against the active anthropic platform cost (plan_tier + billing_cycle match)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-web-search")!;
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "anthropic");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // A mismatch here would make GET /v1/platform-prices/anthropic-web-search 404.
    expect(row.planTier).toBe(platform!.planTier);
    expect(row.billingCycle).toBe(platform!.billingCycle);
  });
});
