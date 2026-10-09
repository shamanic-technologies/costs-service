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
  // Added 2026-09-29 (vendor pages read that day).
  ["anthropic-sonnet-5.5-tokens-input", 2],
  ["anthropic-sonnet-5.5-tokens-cached-input", 0.2],
  ["anthropic-sonnet-5.5-tokens-output", 10],
  ["anthropic-opus-5.5-tokens-input", 4],
  ["anthropic-opus-5.5-tokens-cached-input", 0.2],
  ["anthropic-opus-5.5-tokens-output", 20],
  // Added 2026-10-04: 5-minute cache writes, 1.25x base input (vendor page read that day).
  ["anthropic-fable-5.1-tokens-cache-write-5m", 12.5],
  ["anthropic-sonnet-5.5-tokens-cache-write-5m", 2.5],
  ["anthropic-opus-5.5-tokens-cache-write-5m", 5],
  // Added 2026-10-09: Haiku 5.5, both prompt-size tiers (vendor page read that day).
  ["anthropic-haiku-5.5-tokens-input", 0.1],
  ["anthropic-haiku-5.5-tokens-cached-input", 0.01],
  ["anthropic-haiku-5.5-tokens-cache-write-5m", 0.125],
  ["anthropic-haiku-5.5-tokens-output", 0.5],
  ["anthropic-haiku-5.5-long-context-tokens-input", 0.5],
  ["anthropic-haiku-5.5-long-context-tokens-cached-input", 0.05],
  ["anthropic-haiku-5.5-long-context-tokens-cache-write-5m", 0.625],
  ["anthropic-haiku-5.5-long-context-tokens-output", 2.5],
  ["openai-gpt-6-sol-tokens-input", 2],
  ["openai-gpt-6-sol-tokens-cached-input", 0.2],
  ["openai-gpt-6-sol-tokens-output", 10],
  ["openai-gpt-5.6-sol-tokens-input", 4],
  ["openai-gpt-5.6-sol-tokens-cached-input", 0.4],
  ["openai-gpt-5.6-sol-tokens-output", 20],
  ["openai-gpt-5.6-terra-tokens-input", 2],
  ["openai-gpt-5.6-terra-tokens-cached-input", 0.2],
  ["openai-gpt-5.6-terra-tokens-output", 12],
  // Pre-existing anchors, unchanged — these define the scale.
  ["anthropic-haiku-4.5-tokens-input", 1],
  ["anthropic-haiku-4.5-tokens-output", 5],
  ["anthropic-sonnet-4.6-tokens-input", 3],
  ["anthropic-opus-4.6-tokens-input", 5],
  // TypeSafe Jev 1.13 — input only ($0.042/MTok); the vendor charges nothing for output.
  ["typesafe-jev-1.13-tokens-input", 0.042],
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
    // Each 2026-09-29 model against the sibling whose vendor price is known: the stored ratio
    // must equal the vendor ratio, so a decimal slip on any new row fails here.
    const ratio = (a: string, b: string) => Number(stored(a)) / Number(stored(b));
    const cases: Array<[string, string, number]> = [
      ["anthropic-sonnet-5.5-tokens-input", "anthropic-fable-5.1-tokens-input", 2 / 10],
      ["anthropic-sonnet-5.5-tokens-output", "anthropic-fable-5.1-tokens-output", 10 / 50],
      ["anthropic-sonnet-5.5-tokens-cached-input", "anthropic-fable-5.1-tokens-cached-input", 0.2 / 0.25],
      ["anthropic-opus-5.5-tokens-input", "anthropic-fable-5.1-tokens-input", 4 / 10],
      ["anthropic-opus-5.5-tokens-output", "anthropic-fable-5.1-tokens-output", 20 / 50],
      ["anthropic-opus-5.5-tokens-cached-input", "anthropic-fable-5.1-tokens-cached-input", 0.2 / 0.25],
      ["anthropic-haiku-5.5-tokens-input", "anthropic-sonnet-5.5-tokens-input", 0.1 / 2],
      ["anthropic-haiku-5.5-tokens-output", "anthropic-sonnet-5.5-tokens-output", 0.5 / 10],
      ["anthropic-haiku-5.5-tokens-cache-write-5m", "anthropic-sonnet-5.5-tokens-cache-write-5m", 0.125 / 2.5],
      ["anthropic-haiku-5.5-tokens-cached-input", "anthropic-haiku-5.5-tokens-input", 0.1],
      ["anthropic-haiku-5.5-long-context-tokens-input", "anthropic-haiku-5.5-tokens-input", 5],
      ["anthropic-haiku-5.5-long-context-tokens-output", "anthropic-haiku-5.5-tokens-output", 5],
      ["anthropic-haiku-5.5-long-context-tokens-cached-input", "anthropic-haiku-5.5-tokens-cached-input", 5],
      ["anthropic-haiku-5.5-long-context-tokens-cache-write-5m", "anthropic-haiku-5.5-tokens-cache-write-5m", 5],
      ["openai-gpt-6-sol-tokens-input", "openai-gpt-6-astra-tokens-input", 2 / 10],
      ["openai-gpt-6-sol-tokens-output", "openai-gpt-6-astra-tokens-output", 10 / 50],
      ["openai-gpt-6-sol-tokens-cached-input", "openai-gpt-6-astra-tokens-cached-input", 0.2 / 1],
      ["openai-gpt-5.6-sol-tokens-input", "openai-gpt-6-astra-tokens-input", 4 / 10],
      ["openai-gpt-5.6-sol-tokens-output", "openai-gpt-6-astra-tokens-output", 20 / 50],
      ["openai-gpt-5.6-sol-tokens-cached-input", "openai-gpt-6-astra-tokens-cached-input", 0.4 / 1],
      ["openai-gpt-5.6-terra-tokens-input", "openai-gpt-6-astra-tokens-input", 2 / 10],
      ["openai-gpt-5.6-terra-tokens-output", "openai-gpt-6-astra-tokens-output", 12 / 50],
      ["openai-gpt-5.6-terra-tokens-cached-input", "openai-gpt-6-astra-tokens-cached-input", 0.2 / 1],
    ];
    for (const [a, b, r] of cases) expect(ratio(a, b), `${a} / ${b}`).toBeCloseTo(r, 9);
    // The bug: Fable 5.1's $10/MTok input sat at Haiku 4.5's $1/MTok number.
    expect(stored("anthropic-fable-5.1-tokens-input")).not.toBe(
      stored("anthropic-haiku-4.5-tokens-input"),
    );
  });
});
