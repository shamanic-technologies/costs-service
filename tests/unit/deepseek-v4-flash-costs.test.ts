import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("DeepSeek V4 Flash unit costs (Vercel AI Gateway)", () => {
  it("registers deepseek-v4-flash-tokens-input at $0.44/1M input tokens (peak rate)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("vercel");
    expect(row!.providerDomain).toBe("vercel.com");
    expect(row!.type).toBe("Input tokens (DeepSeek V4 Flash via Vercel AI Gateway)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000440000"));
  });

  it("registers deepseek-v4-flash-tokens-output at $1.32/1M output tokens (peak rate)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-output");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("vercel");
    expect(row!.providerDomain).toBe("vercel.com");
    expect(row!.type).toBe("Output tokens (DeepSeek V4 Flash via Vercel AI Gateway)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001320000"));
  });

  it("prices the PEAK rate, not the off-peak rate (half price)", () => {
    // DeepSeek off-peak is half the peak rate ($0.22 / $0.66 per MTok). Seeding the peak
    // rate means every off-peak hour and every cheaper gateway provider is margin.
    const offPeakInput = applyCostRiskMultiplier("0.0000220000");
    const offPeakOutput = applyCostRiskMultiplier("0.0000660000");
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-input")!;
    const output = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-output")!;
    expect(input.costPerUnitInUsdCents).not.toBe(offPeakInput);
    expect(output.costPerUnitInUsdCents).not.toBe(offPeakOutput);
  });

  it("resolves both rows against the active vercel platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "vercel");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // A mismatch here would make GET /v1/platform-prices/deepseek-v4-flash-tokens-* 404,
    // and a missing platform row would make it 500.
    for (const name of ["deepseek-v4-flash-tokens-input", "deepseek-v4-flash-tokens-output"]) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });

  it("maps the vercel provider to a logo domain", () => {
    expect(PROVIDER_DOMAINS.vercel).toBe("vercel.com");
  });

  it("keeps the vercel provider limited to the DeepSeek token rows", () => {
    const vercelRows = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "vercel").map((c) => c.name);
    expect(vercelRows.sort()).toEqual([
      "deepseek-v4-flash-tokens-input",
      "deepseek-v4-flash-tokens-output",
      "deepseek-v4-pro-tokens-input",
      "deepseek-v4-pro-tokens-output",
    ]);
  });
});
