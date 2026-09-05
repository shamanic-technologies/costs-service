import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Google Gemini 3.8 Flash unit costs (flash-pro alias upgrade)", () => {
  it("registers google-flash-3.8-tokens-input at $1.50/1M input tokens (standard tier)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-3.8-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("google");
    expect(row!.providerDomain).toBe("google.com");
    expect(row!.type).toBe("Input tokens (Gemini 3.8 Flash)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001500000"));
  });

  it("registers google-flash-3.8-tokens-output at $7.50/1M output tokens (standard tier)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-3.8-tokens-output");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("google");
    expect(row!.providerDomain).toBe("google.com");
    expect(row!.type).toBe("Output tokens (Gemini 3.8 Flash)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0007500000"));
  });

  it("prices the 2027 list rate, not the promotional rate active through 2026-12-31", () => {
    // Google's promo is $0.75/MTok input, $3.75/MTok output until 2026-12-31.
    // Seeding the post-promo rate means no reprice when the promotion ends.
    const promoInput = applyCostRiskMultiplier("0.0000750000");
    const promoOutput = applyCostRiskMultiplier("0.0003750000");
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-3.8-tokens-input")!;
    const output = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-3.8-tokens-output")!;
    expect(input.costPerUnitInUsdCents).not.toBe(promoInput);
    expect(output.costPerUnitInUsdCents).not.toBe(promoOutput);
  });

  it("resolves both rows against the active google platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "google");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // A mismatch here would make GET /v1/platform-prices/google-flash-3.8-tokens-* 404.
    for (const name of ["google-flash-3.8-tokens-input", "google-flash-3.8-tokens-output"]) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });

  it("leaves the Gemini 3.7 Flash rows untouched (additive change)", () => {
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-3.7-tokens-input");
    const output = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-3.7-tokens-output");
    expect(input!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001500000"));
    expect(output!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0007500000"));
  });
});
