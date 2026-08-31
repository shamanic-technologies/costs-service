import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

const ZAI_NAMES = [
  "zai-glm-4.7-flashx-tokens-input",
  "zai-glm-4.7-flashx-tokens-cached-input",
  "zai-glm-4.7-flashx-tokens-output",
  "zai-glm-5.2-tokens-input",
  "zai-glm-5.2-tokens-cached-input",
  "zai-glm-5.2-tokens-output",
  "zai-glm-5.3-tokens-input",
  "zai-glm-5.3-tokens-cached-input",
  "zai-glm-5.3-tokens-output",
  "zai-glm-5.3-flash-tokens-input",
  "zai-glm-5.3-flash-tokens-cached-input",
  "zai-glm-5.3-flash-tokens-output",
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

  it("registers zai-glm-5.3-tokens-input at $1.40/1M input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.3-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("zai");
    expect(row!.providerDomain).toBe("z.ai");
    expect(row!.type).toBe("Input tokens (GLM-5.3)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.pricingBasis).toBe("marked-up");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001400000"));
  });

  it("registers zai-glm-5.3-tokens-output at $4.40/1M output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.3-tokens-output");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Output tokens (GLM-5.3)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0004400000"));
  });

  it("registers zai-glm-5.3-tokens-cached-input at $0.26/1M cached input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.3-tokens-cached-input");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Cached input tokens (GLM-5.3)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000260000"));
  });

  it("registers zai-glm-5.3-flash-tokens-input at the $0.15/1M standard list rate", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.3-flash-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("zai");
    expect(row!.providerDomain).toBe("z.ai");
    expect(row!.type).toBe("Input tokens (GLM-5.3-Flash)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.pricingBasis).toBe("marked-up");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000150000"));
  });

  it("registers zai-glm-5.3-flash-tokens-cached-input at the $0.03/1M standard list rate", () => {
    const row = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "zai-glm-5.3-flash-tokens-cached-input",
    );
    expect(row).toBeDefined();
    expect(row!.type).toBe("Cached input tokens (GLM-5.3-Flash)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000030000"));
  });

  it("registers zai-glm-5.3-flash-tokens-output at the $0.50/1M standard list rate", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.3-flash-tokens-output");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Output tokens (GLM-5.3-Flash)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000500000"));
  });

  it("prices GLM-5.3-Flash at the STANDARD rate, never the 50%-off promotion", () => {
    // Z.ai ran a 50% promo ($0.075 / $0.015 / $0.25 per 1M) ending 24:00 2026-09-09 (UTC+8).
    // Seeding it would put the catalog UNDER the vendor rate the moment the promo lapses.
    const promo: Array<[string, string]> = [
      ["zai-glm-5.3-flash-tokens-input", "0.0000075000"],
      ["zai-glm-5.3-flash-tokens-cached-input", "0.0000015000"],
      ["zai-glm-5.3-flash-tokens-output", "0.0000250000"],
    ];
    for (const [name, promoRaw] of promo) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.costPerUnitInUsdCents).not.toBe(applyCostRiskMultiplier(promoRaw));
    }
  });

  it("adds GLM-5.3-Flash alongside GLM-5.3 — the 5.3 rows keep their own prices", () => {
    // A Flash variant is its own model, not a cheaper tier of GLM-5.3: spend declared on a
    // 5.3 name must keep resolving the row it was written with.
    for (const suffix of ["tokens-input", "tokens-cached-input", "tokens-output"]) {
      expect(
        SEED_PROVIDERS_COSTS.filter((c) => c.name === `zai-glm-5.3-${suffix}`),
        `zai-glm-5.3-${suffix} must stay a single in-force version`,
      ).toHaveLength(1);
      expect(
        SEED_PROVIDERS_COSTS.filter((c) => c.name === `zai-glm-5.3-flash-${suffix}`),
        `zai-glm-5.3-flash-${suffix} must be a single in-force version`,
      ).toHaveLength(1);
    }
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.3-tokens-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0001400000"));
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.3-tokens-cached-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0000260000"));
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.3-tokens-output")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0004400000"));
  });

  it("adds GLM-5.3 alongside GLM-5.2 — the 5.2 rows keep their own prices, one version each", () => {
    // GLM-5.3 is a new model, not a reprice of GLM-5.2: spend already declared on a 5.2 name
    // must keep resolving the row it was written with.
    for (const suffix of ["tokens-input", "tokens-cached-input", "tokens-output"]) {
      const v52 = SEED_PROVIDERS_COSTS.filter((c) => c.name === `zai-glm-5.2-${suffix}`);
      const v53 = SEED_PROVIDERS_COSTS.filter((c) => c.name === `zai-glm-5.3-${suffix}`);
      expect(v52, `zai-glm-5.2-${suffix} must stay a single in-force version`).toHaveLength(1);
      expect(v53, `zai-glm-5.3-${suffix} must be a single in-force version`).toHaveLength(1);
      // Identical vendor list price, but each on its own name.
      expect(v53[0].costPerUnitInUsdCents).toBe(v52[0].costPerUnitInUsdCents);
    }
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.2-tokens-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0001400000"));
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.2-tokens-output")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0004400000"));
  });

  it("prices cached input on its own name, never blended into the uncached input rate", () => {
    // Z.ai prices a cached input token at $0.01/MTok (FlashX) and $0.26/MTok (GLM-5.2).
    const flashxCached = applyCostRiskMultiplier("0.0000010000");
    const glm52Cached = applyCostRiskMultiplier("0.0000260000");

    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-4.7-flashx-tokens-cached-input")!
        .costPerUnitInUsdCents,
    ).toBe(flashxCached);
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.2-tokens-cached-input")!
        .costPerUnitInUsdCents,
    ).toBe(glm52Cached);

    // The uncached rows keep the uncached rate — blending would mis-price both modes.
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-4.7-flashx-tokens-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0000070000"));
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "zai-glm-5.2-tokens-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0001400000"));
  });

  it("carries no pricing regime — Z.ai publishes no time-of-day schedule", () => {
    for (const row of SEED_PROVIDERS_COSTS.filter((c) => c.provider === "zai")) {
      expect(row.pricingRegime).toBeUndefined();
      expect(row.regimeHoursUtc).toBeUndefined();
    }
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

  it("keeps the zai provider limited to the declared GLM token rows", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "zai").map((c) => c.name);
    expect(rows.sort()).toEqual([...ZAI_NAMES].sort());
  });

  it("keeps the Kimi rows on their own provider, off the zai rows", () => {
    // The Kimi prices ARE vendor-confirmed now (platform.kimi.ai per-model pricing pages) and
    // live under provider `moonshot` — see moonshot-kimi-costs.test.ts. Z.ai must not absorb
    // them: a Kimi row on the zai provider would resolve against Z.ai's plan.
    for (const row of SEED_PROVIDERS_COSTS.filter((c) => c.name.includes("kimi"))) {
      expect(row.provider).toBe("moonshot");
    }
  });
});
