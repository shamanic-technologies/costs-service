import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Google Gemini embedding unit cost", () => {
  it("registers google-embedding-001-tokens-input at $0.15/1M input tokens (standard tier)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-embedding-001-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("google");
    expect(row!.providerDomain).toBe("google.com");
    expect(row!.type).toBe("Input tokens (Gemini Embedding 001)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000150000"));
  });

  it("resolves against the active google platform cost (plan_tier + billing_cycle match)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-embedding-001-tokens-input")!;
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "google");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // A mismatch here would make GET /v1/platform-prices/google-embedding-001-tokens-input 404.
    expect(row.planTier).toBe(platform!.planTier);
    expect(row.billingCycle).toBe(platform!.billingCycle);
  });
});
