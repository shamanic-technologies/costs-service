import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("DeepSeek V4 Flash unit costs (direct vendor)", () => {
  it("registers deepseek-v4-flash-tokens-input at $0.14/1M input tokens (vendor list, cache miss)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("deepseek");
    expect(row!.providerDomain).toBe("deepseek.com");
    expect(row!.type).toBe("Input tokens (DeepSeek V4 Flash)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000140000"));
  });

  it("registers deepseek-v4-flash-tokens-output at $0.28/1M output tokens (vendor list)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-output");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("deepseek");
    expect(row!.providerDomain).toBe("deepseek.com");
    expect(row!.type).toBe("Output tokens (DeepSeek V4 Flash)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000280000"));
  });

  it("prices off the vendor basis, not the superseded Vercel AI Gateway basis", () => {
    // The gateway rows were $0.44/MTok input and $1.32/MTok output — 3.1x and 4.7x the
    // vendor's own published list price. Re-seeding those values would re-inflate billing.
    const gatewayInput = applyCostRiskMultiplier("0.0000440000");
    const gatewayOutput = applyCostRiskMultiplier("0.0001320000");
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-input")!;
    const output = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-output")!;
    expect(input.costPerUnitInUsdCents).not.toBe(gatewayInput);
    expect(output.costPerUnitInUsdCents).not.toBe(gatewayOutput);
    expect(Number(input.costPerUnitInUsdCents)).toBeLessThan(Number(gatewayInput));
    expect(Number(output.costPerUnitInUsdCents)).toBeLessThan(Number(gatewayOutput));
  });

  it("carries the CACHE-MISS input rate — the cache-hit rate has no cost name yet", () => {
    // DeepSeek prices a V4 Flash cache hit at $0.0028/MTok, 50x cheaper than a miss.
    // There is no cached-input cost name in this catalog, so the input row must stay at the
    // miss rate (over-bills a hit) rather than blend the two, which would mis-price both.
    const cacheHit = applyCostRiskMultiplier("0.0000002800");
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-input")!;
    expect(input.costPerUnitInUsdCents).not.toBe(cacheHit);
    expect(SEED_PROVIDERS_COSTS.some((c) => c.name.includes("cached"))).toBe(false);
  });

  it("resolves both rows against the active deepseek platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "deepseek");
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

  it("maps the deepseek provider to a logo domain", () => {
    expect(PROVIDER_DOMAINS.deepseek).toBe("deepseek.com");
  });

  it("moves every DeepSeek row off the vercel provider, leaving no priced vercel cost", () => {
    const deepseekRows = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "deepseek").map(
      (c) => c.name,
    );
    expect(deepseekRows.sort()).toEqual([
      "deepseek-v4-flash-tokens-input",
      "deepseek-v4-flash-tokens-output",
      "deepseek-v4-pro-tokens-input",
      "deepseek-v4-pro-tokens-output",
    ]);
    expect(SEED_PROVIDERS_COSTS.filter((c) => c.provider === "vercel")).toHaveLength(0);
  });

  it("keeps the vercel platform-cost row until chat-service drops the gateway path", () => {
    expect(SEED_PLATFORM_COSTS.filter((c) => c.provider === "vercel")).toHaveLength(1);
  });
});
