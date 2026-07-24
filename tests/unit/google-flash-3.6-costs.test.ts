import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Google Gemini 3.6 Flash unit costs (flash-pro alias upgrade)", () => {
  it("registers google-flash-3.6-tokens-input at $1.50/1M input tokens (standard tier)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-3.6-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("google");
    expect(row!.providerDomain).toBe("google.com");
    expect(row!.type).toBe("Input tokens (Gemini 3.6 Flash)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001500000"));
  });

  it("registers google-flash-3.6-tokens-output at $7.50/1M output tokens (standard tier)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-3.6-tokens-output");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("google");
    expect(row!.providerDomain).toBe("google.com");
    expect(row!.type).toBe("Output tokens (Gemini 3.6 Flash)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0007500000"));
  });

  it("resolves both rows against the active google platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "google");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // A mismatch here would make GET /v1/platform-prices/google-flash-3.6-tokens-* 404.
    for (const name of ["google-flash-3.6-tokens-input", "google-flash-3.6-tokens-output"]) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });
});
