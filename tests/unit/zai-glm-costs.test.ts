import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

const ZAI_NAMES = [
  "zai-glm-4.7-flashx-tokens-input",
  "zai-glm-4.7-flashx-tokens-output",
  "zai-glm-5.2-tokens-input",
  "zai-glm-5.2-tokens-output",
];

describe("Z.ai GLM unit costs (direct vendor)", () => {
  it("registers zai-glm-4.7-flashx-tokens-input at $0.07/1M input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-4.7-flashx-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("zai");
    expect(row!.providerDomain).toBe("z.ai");
    expect(row!.type).toBe("Input tokens (GLM-4.7-FlashX)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000070000"));
  });

  it("registers zai-glm-4.7-flashx-tokens-output at $0.40/1M output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-4.7-flashx-tokens-output");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Output tokens (GLM-4.7-FlashX)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000400000"));
  });

  it("registers zai-glm-5.2-tokens-input at $1.40/1M input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.2-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("zai");
    expect(row!.type).toBe("Input tokens (GLM-5.2)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001400000"));
  });

  it("registers zai-glm-5.2-tokens-output at $4.40/1M output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.2-tokens-output");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Output tokens (GLM-5.2)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0004400000"));
  });

  it("carries the UNCACHED input rate — the cached-input rate has no cost name yet", () => {
    // Z.ai prices a cached input token at $0.01/MTok (FlashX) and $0.26/MTok (GLM-5.2).
    // No cached-input cost name exists in this catalog, so the input rows stay uncached
    // rather than blend the two rates, which would mis-price both modes.
    const flashxCached = applyCostRiskMultiplier("0.0000010000");
    const glm52Cached = applyCostRiskMultiplier("0.0000260000");
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-4.7-flashx-tokens-input")!
        .costPerUnitInUsdCents,
    ).not.toBe(flashxCached);
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.2-tokens-input")!
        .costPerUnitInUsdCents,
    ).not.toBe(glm52Cached);
  });

  it("resolves every row against the active zai platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "zai");
    expect(platform).toBeDefined();
    // A mismatch would 404 GET /v1/platform-prices/zai-*, a missing platform row would 500.
    for (const name of ZAI_NAMES) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });

  it("declares exactly one zai platform cost and a logo domain", () => {
    expect(SEED_PLATFORM_COSTS.filter((c) => c.provider === "zai")).toHaveLength(1);
    expect(PROVIDER_DOMAINS.zai).toBe("z.ai");
  });

  it("keeps the zai provider limited to the four GLM token rows", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "zai").map((c) => c.name);
    expect(rows.sort()).toEqual([...ZAI_NAMES].sort());
  });

  it("omits the Kimi rows — no vendor-confirmed price yet", () => {
    // kimi-k3 / kimi-k2.6 prices are only available from third-party aggregators today.
    // Pricing a model we cannot confirm at the vendor would bill customers on a guess.
    expect(SEED_PROVIDERS_COSTS.some((c) => c.name.includes("kimi"))).toBe(false);
    expect(SEED_PROVIDERS_COSTS.some((c) => c.provider === "moonshot")).toBe(false);
  });
});
