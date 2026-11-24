import { describe, expect, it } from "vitest";
import { SEED_PLATFORM_COSTS, SEED_PROVIDERS_COSTS, applyCostRiskMultiplier } from "../../src/db/seed.js";

// OPEN-LLM-FREE-1124: chat-service declares these names byte-equal, so each must resolve
// in GET /v1/platform-prices/:name. Full Developer / pay-as-you-go list price (read
// 2026-11-24), never the free tier and never $0.
const usd = (perMTok: number) => applyCostRiskMultiplier((perMTok / 10_000).toFixed(10));

const EXPECTED: Array<[name: string, provider: "cerebras" | "groq", usdPerMTok: number]> = [
  ["cerebras-gpt-oss-120b-tokens-input", "cerebras", 0.35],
  ["cerebras-gpt-oss-120b-tokens-output", "cerebras", 0.75],
  ["cerebras-qwen-3.8-27b-tokens-input", "cerebras", 0.99],
  ["cerebras-qwen-3.8-27b-tokens-output", "cerebras", 1.49],
  ["groq-gpt-oss-120b-tokens-input", "groq", 0.15],
  ["groq-gpt-oss-120b-tokens-cached-input", "groq", 0.075],
  ["groq-gpt-oss-120b-tokens-output", "groq", 0.6],
  ["groq-qwen3.8-27b-tokens-input", "groq", 0.8],
  ["groq-qwen3.8-27b-tokens-cached-input", "groq", 0.8],
  ["groq-qwen3.8-27b-tokens-output", "groq", 4],
];

describe("open-weight LLM costs on Cerebras and Groq (OPEN-LLM-FREE-1124)", () => {
  it.each(EXPECTED)("%s is seeded once at the vendor list price x markup", (name, provider, perMTok) => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.provider).toBe(provider);
    expect(row.providerDomain).toBe(provider === "groq" ? "groq.com" : "cerebras.ai");
    expect(row.costPerUnitInUsdCents).toBe(usd(perMTok));
    expect(Number(row.costPerUnitInUsdCents)).toBeGreaterThan(0);
    expect(row.pricingBasis).toBe("marked-up");
  });

  it.each(["cerebras", "groq"])("%s has an active platform cost on the rows' plan (else the read 500s)", (provider) => {
    const platform = SEED_PLATFORM_COSTS.find((p) => p.provider === provider);
    expect(platform).toBeDefined();
    for (const row of SEED_PROVIDERS_COSTS.filter((c) => c.provider === provider)) {
      expect([row.planTier, row.billingCycle]).toEqual([platform!.planTier, platform!.billingCycle]);
    }
  });

  it("seeds no Cerebras cached-input row (Cerebras bills cache hits at the input rate)", () => {
    expect(SEED_PROVIDERS_COSTS.some((c) => c.provider === "cerebras" && c.name.includes("cached"))).toBe(false);
  });
});
