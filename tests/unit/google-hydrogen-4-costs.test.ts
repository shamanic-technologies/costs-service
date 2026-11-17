import { describe, expect, it } from "vitest";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS, applyCostRiskMultiplier } from "../../src/db/seed.js";

// HYDROGEN-PRICES-1113. Gemini 4 Hydrogen, Google Standard paid tier per 1M tokens (USD),
// read from https://ai.google.dev/gemini-api/docs/pricing on 2026-11-13:
//   input $1.50 · output $7.50 (thinking included) · cached input $0.075 (implicit only)
// Flat across the 1M context: no long-context tier. chat-service copies these names byte-equal.
const ROWS: Array<[suffix: string, type: string, usdPerMTok: number]> = [
  ["tokens-input", "Input tokens (Gemini 4 Hydrogen)", 1.5],
  ["tokens-cached-input", "Cached input tokens (Gemini 4 Hydrogen)", 0.075],
  ["tokens-output", "Output tokens (Gemini 4 Hydrogen)", 7.5],
];

describe("Google Gemini 4 Hydrogen unit costs (HYDROGEN-PRICES-1113)", () => {
  const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "google")!;

  for (const [suffix, type, usd] of ROWS) {
    const name = `google-hydrogen-4-${suffix}`;
    it(`registers ${name} once, at the vendor full list price under the store markup`, () => {
      const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.provider).toBe("google");
      expect(row.type).toBe(type);
      expect(row.unit).toBe("1M tokens");
      expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier((usd / 10_000).toFixed(10)));
      expect(row.pricingBasis).toBe("marked-up");
      expect(row.pricingRegime).toBeUndefined();
      // Resolvable by GET /v1/platform-prices/:name (tier mismatch = 404).
      expect(row.planTier).toBe(platform.planTier);
      expect(row.billingCycle).toBe(platform.billingCycle);
      // A new model: one version dated at its release, never back-dated.
      expect(row.effectiveFrom.toISOString()).toBe("2026-11-12T00:00:00.000Z");
    });
  }

  it("declares no long-context tier (Google prices Hydrogen flat across 1M tokens)", () => {
    expect(SEED_PROVIDERS_COSTS.filter((c) => c.name.startsWith("google-hydrogen-4-long-context"))).toHaveLength(0);
  });

  it("leaves every Gemini 4 Argon row priced as written", () => {
    const argon: Array<[string, string]> = [
      ["tokens-input", "0.0004000000"],
      ["tokens-cached-input", "0.0000200000"],
      ["tokens-output", "0.0020000000"],
    ];
    for (const [suffix, raw] of argon) {
      const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === `google-argon-4-${suffix}`);
      expect(rows).toHaveLength(1);
      expect(rows[0].costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(raw));
    }
  });
});
