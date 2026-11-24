import { describe, expect, it } from "vitest";
import {
  COST_DEFAULT_MULTIPLIER,
  OPENROUTER_CREDIT_FEE_MULTIPLIER,
  SEED_PLATFORM_COSTS,
  SEED_PROVIDERS_COSTS,
  applyCostRiskMultiplier,
  withOpenRouterFee,
} from "../../src/db/seed.js";
import { seedVendorCost } from "../../src/lib/vendor-cost.js";

// OPENROUTER-CHEAP-LLM-1124: chat-service declares these 36 names byte-equal, so each must
// resolve in GET /v1/platform-prices/:name. Price = the PINNED host's full list price on
// OpenRouter (endpoints API read 2026-11-24) x OpenRouter's 5.5% credit fee x store markup.
// Never $0, never a :free variant, never the 50% Tencent discount, never DeepSeek's off-peak rate.
const HOST_USD_PER_MTOK: Array<[prefix: string, input: number, cached: number, cacheWrite: number, output: number]> = [
  ["openrouter-antdigital-ling-3.0-tiny", 0.015, 0.003, 0.015, 0.045],
  ["openrouter-nexagi-nex-n2.5-mini", 0.025, 0.0025, 0.025, 0.1],
  ["openrouter-tencent-hy4-flash", 0.07, 0.003, 0.07, 0.281],
  ["openrouter-alibaba-deepseek-v4.1-flash-1017", 0.18, 0.0036, 0.18, 0.72],
  ["openrouter-alibaba-qwen3.7-flash", 0.03, 0.006, 0.038, 0.13],
  ["openrouter-alibaba-qwen3.7-flash-long-context", 0.2, 0.04, 0.25, 0.8],
  ["openrouter-deepinfra-llama-3.1-8b-instruct", 0.02, 0.02, 0.02, 0.04],
  ["openrouter-deepinfra-gpt-oss-20b", 0.03, 0.015, 0.03, 0.14],
  ["openrouter-deepinfra-gpt-oss-120b", 0.037, 0.0185, 0.037, 0.17],
];

const EXPECTED: Array<[name: string, usdPerMTok: number]> = HOST_USD_PER_MTOK.flatMap(([p, i, c, w, o]) => [
  [`${p}-tokens-input`, i],
  [`${p}-tokens-cached-input`, c],
  [`${p}-tokens-cache-write`, w],
  [`${p}-tokens-output`, o],
]);

describe("OpenRouter pinned-host LLM costs (OPENROUTER-CHEAP-LLM-1124)", () => {
  it("covers exactly the 36 locked names", () => {
    expect(EXPECTED).toHaveLength(36);
    expect(SEED_PROVIDERS_COSTS.filter((c) => c.provider === "openrouter").map((c) => c.name).sort()).toEqual(
      EXPECTED.map(([n]) => n).sort(),
    );
  });

  it.each(EXPECTED)("%s = host list x 1.055 fee x markup, seeded once", (name, perMTok) => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.provider).toBe("openrouter");
    expect(row.providerDomain).toBe("openrouter.ai");
    expect(row.unit).toBe("1M tokens");
    expect(row.pricingBasis).toBe("marked-up");
    expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(withOpenRouterFee((perMTok / 10_000).toFixed(10))));
    // Scale guard independent of the helpers: cents per token = $/MTok / 10,000 x fee x markup.
    const exact = (perMTok / 10_000) * OPENROUTER_CREDIT_FEE_MULTIPLIER * COST_DEFAULT_MULTIPLIER;
    expect(Math.abs(Number(row.costPerUnitInUsdCents) - exact)).toBeLessThanOrEqual(5e-10 * COST_DEFAULT_MULTIPLIER + 1e-15);
    expect(Number(row.costPerUnitInUsdCents)).toBeGreaterThan(0);
  });

  it("states the fee-inclusive vendor rate (fee is vendor basis, never markup)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "openrouter-deepinfra-gpt-oss-120b-tokens-output")!;
    expect(seedVendorCost(row)).toBe(withOpenRouterFee((0.17 / 10_000).toFixed(10)));
    expect(OPENROUTER_CREDIT_FEE_MULTIPLIER).toBe(1.055);
  });

  it("has an active platform cost on the rows' plan (else the read 500s)", () => {
    const platform = SEED_PLATFORM_COSTS.find((p) => p.provider === "openrouter");
    expect(platform).toBeDefined();
    for (const row of SEED_PROVIDERS_COSTS.filter((c) => c.provider === "openrouter")) {
      expect([row.planTier, row.billingCycle]).toEqual([platform!.planTier, platform!.billingCycle]);
    }
  });
});
