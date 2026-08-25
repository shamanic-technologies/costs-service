import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
  withChinaVat,
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

  it("keeps the superseded row at the CACHE-MISS rate, never blended with the cache-hit rate", () => {
    // DeepSeek prices a V4 Flash cache hit at $0.0028/MTok, 50x cheaper than a miss.
    // This row predates the cached-input names and must stay at the miss rate — blending the
    // two into one input price would mis-price both modes.
    const cacheHit = applyCostRiskMultiplier("0.0000002800");
    const input = SEED_PROVIDERS_COSTS.find((c) => c.name === "deepseek-v4-flash-tokens-input")!;
    expect(input.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000140000"));
    expect(input.costPerUnitInUsdCents).not.toBe(cacheHit);
  });

  it("prices the cache-hit input token on its own name, at the vendor's cache-hit rate", () => {
    // The dimension the superseded row could not express. Declaring a cache hit against
    // `-tokens-input` would over-charge it 50x.
    const cached = SEED_PROVIDERS_COSTS.filter(
      (c) => c.name === "deepseek-v4-flash-peak-tokens-cached-input",
    );
    const current = cached.find((c) => c.effectiveFrom.toISOString() === "2025-01-01T00:00:00.000Z")!;
    expect(current.costPerUnitInUsdCents).toBe(
      applyCostRiskMultiplier(withChinaVat("0.0000002800")),
    );
    expect(current.type).toBe("Cached input tokens (DeepSeek V4 Flash, peak)");
    // The 50x gap between a hit and a miss survives the VAT, which is a common factor.
    expect(Number(current.costPerUnitInUsdCents) * 50).toBeCloseTo(
      Number(applyCostRiskMultiplier(withChinaVat("0.0000140000"))),
      12,
    );
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
    const deepseekNames = new Set(
      SEED_PROVIDERS_COSTS.filter((c) => c.provider === "deepseek").map((c) => c.name),
    );
    expect([...deepseekNames].sort()).toEqual([
      "deepseek-v4-flash-off-peak-tokens-cached-input",
      "deepseek-v4-flash-off-peak-tokens-input",
      "deepseek-v4-flash-off-peak-tokens-output",
      "deepseek-v4-flash-peak-tokens-cached-input",
      "deepseek-v4-flash-peak-tokens-input",
      "deepseek-v4-flash-peak-tokens-output",
      "deepseek-v4-flash-tokens-input",
      "deepseek-v4-flash-tokens-output",
      "deepseek-v4-pro-off-peak-tokens-cached-input",
      "deepseek-v4-pro-off-peak-tokens-input",
      "deepseek-v4-pro-off-peak-tokens-output",
      "deepseek-v4-pro-peak-tokens-cached-input",
      "deepseek-v4-pro-peak-tokens-input",
      "deepseek-v4-pro-peak-tokens-output",
      "deepseek-v4-pro-tokens-input",
      "deepseek-v4-pro-tokens-output",
    ]);
    expect(SEED_PROVIDERS_COSTS.filter((c) => c.provider === "vercel")).toHaveLength(0);
  });

  it("retires the vercel platform-cost row now that chat-service dropped the gateway", () => {
    // chat-service v0.51.0 removed the AI Gateway path; nothing routes through Vercel. The
    // catalog stops declaring the provider entirely — there is no honest plan to name for a
    // provider we no longer buy from, the same call made for the superseded flat DeepSeek
    // cost names above (frozen, not re-priced).
    //
    // This does NOT delete anything in production: the seed is append-only, so the prod
    // `vercel` platform row and the four gateway-priced `deepseek-v4-*-tokens-*` rows dated
    // 2025-01-01 survive as history, which is what lets spend already declared under those
    // names read back at the price it was written with.
    expect(SEED_PLATFORM_COSTS.filter((c) => c.provider === "vercel")).toHaveLength(0);
    expect(SEED_PROVIDERS_COSTS.filter((c) => c.provider === "vercel")).toHaveLength(0);
    expect(PROVIDER_DOMAINS.vercel).toBeUndefined();
  });
});
