import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("DeepSeek V4 Pro unit costs (direct vendor)", () => {
  it("registers deepseek-v4-pro-tokens-input at $0.435/1M input tokens (vendor list, cache miss)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("deepseek");
    expect(row!.providerDomain).toBe("deepseek.com");
    expect(row!.type).toBe("Input tokens (DeepSeek V4 Pro)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000435000"));
  });

  it("registers deepseek-v4-pro-tokens-output at $0.87/1M output tokens (vendor list)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-output");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("deepseek");
    expect(row!.providerDomain).toBe("deepseek.com");
    expect(row!.type).toBe("Output tokens (DeepSeek V4 Pro)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000870000"));
  });

  it("prices Pro output at twice Pro input, matching the vendor catalog ratio", () => {
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-input")!;
    const output = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-output")!;
    expect(Number(output.costPerUnitInUsdCents)).toBeCloseTo(
      Number(input.costPerUnitInUsdCents) * 2,
      12,
    );
  });

  it("prices off the vendor basis, not the superseded Vercel AI Gateway basis", () => {
    // The gateway rows were $1.74/MTok input and $3.48/MTok output — 4x the vendor's own list.
    const gatewayInput = applyCostRiskMultiplier("0.0001740000");
    const gatewayOutput = applyCostRiskMultiplier("0.0003480000");
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-input")!;
    const output = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-output")!;
    expect(Number(input.costPerUnitInUsdCents)).toBeLessThan(Number(gatewayInput));
    expect(Number(output.costPerUnitInUsdCents)).toBeLessThan(Number(gatewayOutput));
  });

  it("keeps the superseded row at the CACHE-MISS rate, never blended with the cache-hit rate", () => {
    // DeepSeek prices a V4 Pro cache hit at $0.003625/MTok, 120x cheaper than a miss.
    const cacheHit = applyCostRiskMultiplier("0.0000003625");
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-pro-tokens-input")!;
    expect(input.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000435000"));
    expect(input.costPerUnitInUsdCents).not.toBe(cacheHit);
  });

  it("prices the cache-hit input token on its own name, at the vendor's cache-hit rate", () => {
    const current = SEED_PROVIDERS_COSTS.find(
      (c) =>
        c.name === "deepseek-v4-pro-off-peak-tokens-cached-input" &&
        c.effectiveFrom.toISOString() === "2025-01-01T00:00:00.000Z",
    )!;
    expect(current.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000003625"));
    expect(current.type).toBe("Cached input tokens (DeepSeek V4 Pro, off-peak)");
  });

  it("resolves both rows against the active deepseek platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "deepseek");
    expect(platform).toBeDefined();
    for (const name of ["deepseek-v4-pro-tokens-input", "deepseek-v4-pro-tokens-output"]) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });

  it("declares exactly one deepseek platform cost, shared by the Flash and Pro rows", () => {
    const platformRows = SEED_PLATFORM_COSTS.filter((c) => c.provider === "deepseek");
    expect(platformRows).toHaveLength(1);
    expect(PROVIDER_DOMAINS.deepseek).toBe("deepseek.com");
  });

  it("names every DeepSeek row {model}[-{regime}]-tokens-{class} and nothing else", () => {
    const names = new Set(
      SEED_PROVIDERS_COSTS.filter((c) => c.name.startsWith("deepseek-")).map((c) => c.name),
    );
    for (const name of names) {
      expect(name).toMatch(
        /^deepseek-v4-(flash|pro)(-(peak|off-peak))?-tokens-(input|cached-input|output)$/,
      );
    }
  });
});
