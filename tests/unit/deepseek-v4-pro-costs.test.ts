import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("DeepSeek V4 Pro unit costs (Vercel AI Gateway)", () => {
  it("registers deepseek-v4-pro-tokens-input at $1.74/1M input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("vercel");
    expect(row!.providerDomain).toBe("vercel.com");
    expect(row!.type).toBe("Input tokens (DeepSeek V4 Pro via Vercel AI Gateway)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001740000"));
  });

  it("registers deepseek-v4-pro-tokens-output at $3.48/1M output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-output");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("vercel");
    expect(row!.providerDomain).toBe("vercel.com");
    expect(row!.type).toBe("Output tokens (DeepSeek V4 Pro via Vercel AI Gateway)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0003480000"));
  });

  it("prices Pro output at twice Pro input, matching the vendor catalog ratio", () => {
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-input")!;
    const output = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-output")!;
    expect(Number(output.costPerUnitInUsdCents)).toBeCloseTo(
      Number(input.costPerUnitInUsdCents) * 2,
      12,
    );
  });

  it("resolves both rows against the active vercel platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "vercel");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // A mismatch here would make GET /v1/platform-prices/deepseek-v4-pro-tokens-* 404,
    // and a missing platform row would make it 500.
    for (const name of ["deepseek-v4-pro-tokens-input", "deepseek-v4-pro-tokens-output"]) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });

  it("declares exactly one vercel platform cost, shared by the Flash and Pro rows", () => {
    const platformRows = SEED_PLATFORM_COSTS.filter((c) => c.provider === "vercel");
    expect(platformRows).toHaveLength(1);
    expect(PROVIDER_DOMAINS.vercel).toBe("vercel.com");
  });

  it("leaves the existing DeepSeek V4 Flash prices untouched", () => {
    const flashInput = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-input")!;
    const flashOutput = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "deepseek-v4-flash-tokens-output",
    )!;
    expect(flashInput.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000440000"));
    expect(flashOutput.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001320000"));
  });

  it("names the Pro rows distinctly from the Flash rows (no version-dated variants)", () => {
    const deepseekRows = SEED_PROVIDERS_COSTS.filter((c) => c.name.startsWith("deepseek-")).map(
      (c) => c.name,
    );
    expect(new Set(deepseekRows).size).toBe(deepseekRows.length);
    for (const name of deepseekRows) {
      expect(name).toMatch(/^deepseek-v4-(flash|pro)-tokens-(input|output)$/);
    }
  });
});
