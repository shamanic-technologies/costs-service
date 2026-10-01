import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Google's published standard-tier rates (https://ai.google.dev/gemini-api/docs/pricing,
// read 2026-10-01), USD cents per token. chat-service declares these names per request:
// a cache hit under -tokens-cached-input, a >200k-token prompt under -long-context-*,
// and Flash Image's text/thinking output under -tokens-text-output.
const EXPECTED: Record<string, string> = {
  "google-pro-3.1-tokens-cached-input": "0.0000200000", // $0.20/1M
  "google-pro-2.5-tokens-cached-input": "0.0000125000", // $0.125/1M
  "google-flash-3.8-tokens-cached-input": "0.0000150000", // $0.15/1M (2027 list)
  "google-flash-3.7-tokens-cached-input": "0.0000150000",
  "google-flash-3.6-tokens-cached-input": "0.0000150000",
  "google-flash-3.5-tokens-cached-input": "0.0000150000",
  "google-flash-3-tokens-cached-input": "0.0000050000", // $0.05/1M
  "google-flash-lite-3.5-tokens-cached-input": "0.0000030000", // $0.03/1M
  "google-flash-lite-3.1-tokens-cached-input": "0.0000025000", // $0.025/1M
  "google-flash-2.5-tokens-cached-input": "0.0000030000", // $0.03/1M
  "google-flash-lite-2.5-tokens-cached-input": "0.0000010000", // $0.01/1M
  "google-pro-3.1-long-context-tokens-input": "0.0004000000", // $4/1M
  "google-pro-3.1-long-context-tokens-cached-input": "0.0000400000", // $0.40/1M
  "google-pro-3.1-long-context-tokens-output": "0.0018000000", // $18/1M
  "google-pro-2.5-long-context-tokens-input": "0.0002500000", // $2.50/1M
  "google-pro-2.5-long-context-tokens-cached-input": "0.0000250000", // $0.25/1M
  "google-pro-2.5-long-context-tokens-output": "0.0015000000", // $15/1M
  "google-flash-image-3.1-tokens-text-output": "0.0003000000", // $3/1M
};

describe("Google Gemini cache-hit, long-context and image text-output costs", () => {
  for (const [name, vendor] of Object.entries(EXPECTED)) {
    it(`registers ${name} at the vendor rate x the standard markup`, () => {
      const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
      expect(rows).toHaveLength(1);
      expect(rows[0].provider).toBe("google");
      expect(rows[0].unit).toBe("1M tokens");
      expect(rows[0].pricingBasis).toBe("marked-up");
      expect(rows[0].costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(vendor));
    });
  }

  it("prices every cache hit at a tenth of the same model's input", () => {
    for (const name of Object.keys(EXPECTED).filter((n) => n.endsWith("-tokens-cached-input"))) {
      const input = SEED_PROVIDERS_COSTS.find((c) => c.name === name.replace("-tokens-cached-input", "-tokens-input"))!;
      const cached = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(Number(cached.costPerUnitInUsdCents) * 10).toBeCloseTo(Number(input.costPerUnitInUsdCents), 12);
    }
  });

  it("resolves every row against the active google platform cost", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "google")!;
    for (const name of Object.keys(EXPECTED)) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform.planTier);
      expect(row.billingCycle).toBe(platform.billingCycle);
    }
  });

  it("leaves the existing Gemini input/output rows untouched (additive change)", () => {
    expect(SEED_PROVIDERS_COSTS.find((c) => c.name === "google-pro-3.1-tokens-input")!.costPerUnitInUsdCents).toBe(
      applyCostRiskMultiplier("0.0002000000"),
    );
    expect(SEED_PROVIDERS_COSTS.find((c) => c.name === "google-flash-image-3.1-tokens-output")!.costPerUnitInUsdCents).toBe(
      applyCostRiskMultiplier("0.0060000000"),
    );
  });
});
