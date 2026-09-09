import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS, applyCostRiskMultiplier } from "../../src/db/seed.js";

// Regression for the 10x under-pricing shipped in #240 (v0.55.0): Claude Fable 5.1 and OpenAI
// GPT-6 Astra were seeded at $/MTok / 100,000 instead of $/MTok / 10,000, so all six rows sat a
// decade below every other `unit: "1M tokens"` row in the catalog. Fable 5.1 lists at TEN times
// Haiku 4.5's input price and was stored at Haiku's exact number.
//
// One vendor dollar figure must map to one stored value regardless of which model carries it.
// A `unit: "1M tokens"` row stores VENDOR CENTS PER TOKEN under the store markup:
//
//   stored = applyCostRiskMultiplier(($/MTok x 100 cents) / 1,000,000 tokens)
//          = applyCostRiskMultiplier($/MTok / 10,000)
//
// The table below carries the corrected models AND pre-existing anchors that were always right,
// so a future mis-scaled row breaks against rows nobody is editing. Every value comes from the
// vendor's own published table:
//   https://platform.claude.com/docs/en/about-claude/pricing        (read 2026-09-09)
//   https://developers.openai.com/api/docs/pricing                 (read 2026-09-09)
const VENDOR_USD_PER_MTOK: Array<[name: string, usdPerMTok: number]> = [
  // Corrected in this PR.
  ["anthropic-fable-5.1-tokens-input", 10],
  ["anthropic-fable-5.1-tokens-cached-input", 0.25],
  ["anthropic-fable-5.1-tokens-output", 50],
  ["openai-gpt-6-astra-tokens-input", 10],
  ["openai-gpt-6-astra-tokens-cached-input", 1],
  ["openai-gpt-6-astra-tokens-output", 50],
  // Pre-existing anchors, unchanged — these define the scale.
  ["anthropic-haiku-4.5-tokens-input", 1],
  ["anthropic-haiku-4.5-tokens-output", 5],
  ["anthropic-sonnet-4.6-tokens-input", 3],
  ["anthropic-opus-4.6-tokens-input", 5],
];

/** Vendor dollars per 1M tokens -> the raw cents-per-token literal the seed carries. */
function rawCentsPerToken(usdPerMTok: number): string {
  return ((usdPerMTok * 100) / 1_000_000).toFixed(10);
}

describe("token price scale (regression: Fable 5.1 / GPT-6 Astra 10x under-priced in #240)", () => {
  for (const [name, usdPerMTok] of VENDOR_USD_PER_MTOK) {
    it(`prices ${name} at the vendor's $${usdPerMTok}/MTok under the store markup`, () => {
      const row = SEED_PROVIDERS_COSTS.filter((c) => c.name === name).at(-1);
      expect(row, `${name} missing from the seed catalog`).toBeDefined();
      expect(row!.unit).toBe("1M tokens");
      expect(row!.costPerUnitInUsdCents).toBe(
        applyCostRiskMultiplier(rawCentsPerToken(usdPerMTok)),
      );
    });
  }

  it("maps the same vendor dollar figure to the same stored value across models and vendors", () => {
    // $10/MTok input on Fable 5.1, on Astra, and 10x Haiku 4.5's $1/MTok — all one number.
    const stored = (name: string) =>
      SEED_PROVIDERS_COSTS.filter((c) => c.name === name).at(-1)!.costPerUnitInUsdCents;

    expect(stored("anthropic-fable-5.1-tokens-input")).toBe(
      stored("openai-gpt-6-astra-tokens-input"),
    );
    expect(Number(stored("anthropic-fable-5.1-tokens-input"))).toBeCloseTo(
      Number(stored("anthropic-haiku-4.5-tokens-input")) * 10,
      12,
    );
    expect(Number(stored("anthropic-fable-5.1-tokens-output"))).toBeCloseTo(
      Number(stored("anthropic-haiku-4.5-tokens-output")) * 10,
      12,
    );
    // The bug: Fable 5.1's $10/MTok input sat at Haiku 4.5's $1/MTok number.
    expect(stored("anthropic-fable-5.1-tokens-input")).not.toBe(
      stored("anthropic-haiku-4.5-tokens-input"),
    );
  });
});
