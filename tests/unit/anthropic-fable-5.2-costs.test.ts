import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";
import { RETIRED_COST_NAMES } from "../../src/lib/retired-cost-names.js";

// Vendor table, per 1M tokens (USD), from
// https://platform.claude.com/docs/en/about-claude/pricing (raw HTML read 2026-11-12):
//   Claude Fable 5.2 — input $8 · cache hit $0.20 (0.025x) · 5m cache write $10 · output $40
// chat-service (FABLE-5-2-PRICES-1112) declares exactly these four names; runs-service 422s a
// name the catalogue does not carry.
const ROWS: Array<[suffix: string, type: string, raw: string]> = [
  ["tokens-input", "Input tokens (Fable 5.2)", "0.0008000000"],
  ["tokens-cached-input", "Cached input tokens (Fable 5.2)", "0.0000200000"],
  ["tokens-cache-write-5m", "Cache write tokens, 5-minute TTL (Fable 5.2)", "0.0010000000"],
  ["tokens-output", "Output tokens (Fable 5.2)", "0.0040000000"],
];

describe("Anthropic Claude Fable 5.2 unit costs (FABLE-5-2-PRICES-1112)", () => {
  const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "anthropic")!;

  for (const [suffix, type, raw] of ROWS) {
    const name = `anthropic-fable-5.2-${suffix}`;
    it(`registers ${name} once, at the vendor list price under the store markup`, () => {
      const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.provider).toBe("anthropic");
      expect(row.type).toBe(type);
      expect(row.unit).toBe("1M tokens");
      expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(raw));
      expect(row.pricingBasis).toBe("marked-up");
      expect(row.pricingRegime).toBeUndefined();
      // Resolvable by GET /v1/platform-prices/:name (tier mismatch = 404).
      expect(row.planTier).toBe(platform.planTier);
      expect(row.billingCycle).toBe(platform.billingCycle);
      // A new model: one version dated at its release, never back-dated.
      expect(row.effectiveFrom.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    });
  }

  it("leaves every Fable 5.1 row priced as written, retired in favour of its 5.2 twin", () => {
    const fable51: Array<[string, string]> = [
      ["tokens-input", "0.0010000000"],
      ["tokens-cached-input", "0.0000250000"],
      ["tokens-cache-write-5m", "0.0012500000"],
      ["tokens-output", "0.0050000000"],
    ];
    for (const [suffix, raw] of fable51) {
      const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === `anthropic-fable-5.1-${suffix}`);
      expect(rows).toHaveLength(1);
      expect(rows[0].costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(raw));
      expect(RETIRED_COST_NAMES[`anthropic-fable-5.1-${suffix}`]?.supersededBy).toEqual([
        `anthropic-fable-5.2-${suffix}`,
      ]);
    }
  });
});
