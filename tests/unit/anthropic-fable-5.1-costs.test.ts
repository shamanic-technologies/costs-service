import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Vendor table, per 1M tokens (USD), from
// https://platform.claude.com/docs/en/about-claude/pricing (read 2026-09-09):
//   Claude Fable 5.1 — base input $10.00 · cache hit $0.25 · output $50.00
const FABLE_NAMES = [
  "anthropic-fable-5.1-tokens-input",
  "anthropic-fable-5.1-tokens-cached-input",
  "anthropic-fable-5.1-tokens-output",
];

describe("Anthropic Claude Fable 5.1 unit costs", () => {
  it("registers anthropic-fable-5.1-tokens-input at $10.00/1M base input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-fable-5.1-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("anthropic");
    expect(row!.providerDomain).toBe("anthropic.com");
    expect(row!.type).toBe("Input tokens (Fable 5.1)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001000000"));
  });

  it("registers anthropic-fable-5.1-tokens-output at $50.00/1M output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-fable-5.1-tokens-output");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Output tokens (Fable 5.1)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0005000000"));
  });

  it("prices the cache hit at the vendor's published $0.25/1M, NOT a derived 0.1x of base input", () => {
    // Fable 5.1 prices cache hits at 0.025x base input, not the 0.1x every other Claude model
    // uses — the pricing page states that in a table footnote and again in the prompt-caching
    // multiplier table. Deriving the rate from the input row would over-charge 4x.
    const cached = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "anthropic-fable-5.1-tokens-cached-input",
    );
    expect(cached).toBeDefined();
    expect(cached!.type).toBe("Cached input tokens (Fable 5.1)");
    expect(cached!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000025000"));

    // 0.025x of base input, and specifically NOT the standard 0.1x.
    const base = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "anthropic-fable-5.1-tokens-input",
    )!;
    expect(Number(cached!.costPerUnitInUsdCents)).toBeCloseTo(
      Number(base.costPerUnitInUsdCents) * 0.025,
      12,
    );
    expect(cached!.costPerUnitInUsdCents).not.toBe(applyCostRiskMultiplier("0.0000100000"));
  });

  it("marks every Fable 5.1 line marked-up — LLM tokens are work we perform, not money we route", () => {
    for (const name of FABLE_NAMES) {
      expect(SEED_PROVIDERS_COSTS.find((c) => c.name === name)!.pricingBasis).toBe("marked-up");
    }
  });

  it("carries no pricing regime — Anthropic publishes no time-of-day schedule", () => {
    for (const name of FABLE_NAMES) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.pricingRegime).toBeUndefined();
      expect(row.regimeHoursUtc).toBeUndefined();
    }
  });

  it("resolves every row against the active anthropic platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "anthropic");
    expect(platform).toBeDefined();
    // A mismatch 404s GET /v1/platform-prices/anthropic-fable-5.1-*; a missing platform row 500s.
    for (const name of FABLE_NAMES) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
    expect(SEED_PLATFORM_COSTS.filter((c) => c.provider === "anthropic")).toHaveLength(1);
    expect(PROVIDER_DOMAINS.anthropic).toBe("anthropic.com");
  });

  it("declares each name exactly once — no second version competing with the launch price", () => {
    for (const name of FABLE_NAMES) {
      expect(SEED_PROVIDERS_COSTS.filter((c) => c.name === name)).toHaveLength(1);
    }
  });

  it("leaves every pre-existing Anthropic model's price untouched", () => {
    // Adding a model must not reprice one. Spot-check the two ends of the existing range.
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-opus-4.5-tokens-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0005000000"));
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-haiku-4.5-tokens-output")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0005000000"));
  });
});
