import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Google Gemini 3.1 Flash Image unit costs", () => {
  it("registers google-flash-image-3.1-tokens-input at $0.50/1M input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-image-3.1-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("google");
    expect(row!.providerDomain).toBe("google.com");
    expect(row!.type).toBe("Input tokens (Gemini 3.1 Flash Image)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000500000"));
  });

  it("registers google-flash-image-3.1-tokens-output at $60/1M image output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-image-3.1-tokens-output");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("google");
    expect(row!.providerDomain).toBe("google.com");
    expect(row!.type).toBe("Image output tokens (Gemini 3.1 Flash Image)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0060000000"));
  });

  it("resolves both rows against the active google platform cost", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "google");
    expect(platform).toBeDefined();
    for (const name of [
      "google-flash-image-3.1-tokens-input",
      "google-flash-image-3.1-tokens-output",
    ]) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });
});
