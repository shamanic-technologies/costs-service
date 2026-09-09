import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Vendor table, per 1M tokens (USD), from
// https://developers.openai.com/api/docs/pricing (read 2026-09-09):
//   gpt-6-astra (released 2026-09-03) — short context: input $10.00 · cached input $1.00 ·
//   output $50.00. The long-context column ($20 / $2 / $75) is deliberately not seeded: the
//   page states no threshold at which a request crosses into it, so no name could say when it
//   applies. See the seed comment on the OpenAI block.
const ASTRA_NAMES = [
  "openai-gpt-6-astra-tokens-input",
  "openai-gpt-6-astra-tokens-cached-input",
  "openai-gpt-6-astra-tokens-output",
];

describe("OpenAI GPT-6 Astra unit costs (new direct vendor)", () => {
  it("registers openai-gpt-6-astra-tokens-input at $10.00/1M input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "openai-gpt-6-astra-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("openai");
    expect(row!.providerDomain).toBe("openai.com");
    expect(row!.type).toBe("Input tokens (GPT-6 Astra)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0010000000"));
  });

  it("registers openai-gpt-6-astra-tokens-output at $50.00/1M output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "openai-gpt-6-astra-tokens-output");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Output tokens (GPT-6 Astra)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0050000000"));
  });

  it("prices cached input on its own name at $1.00/1M, never blended into the uncached rate", () => {
    const cached = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "openai-gpt-6-astra-tokens-cached-input",
    );
    expect(cached).toBeDefined();
    expect(cached!.type).toBe("Cached input tokens (GPT-6 Astra)");
    expect(cached!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0001000000"));

    // The uncached row keeps the uncached rate — blending would mis-price both modes.
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "openai-gpt-6-astra-tokens-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0010000000"));
  });

  it("differs from Fable 5.1 on the cached line only — the two are identical on input/output", () => {
    // Both vendors publish $10 in / $50 out; only the cache-hit rate distinguishes them
    // ($1.00 for Astra vs $0.25 for Fable 5.1). A copy-paste that carried one model's cache
    // rate onto the other would be invisible in the input/output rows.
    for (const suffix of ["-tokens-input", "-tokens-output"]) {
      expect(
        SEED_PROVIDERS_COSTS.find((c) => c.name === `openai-gpt-6-astra${suffix}`)!
          .costPerUnitInUsdCents,
      ).toBe(
        SEED_PROVIDERS_COSTS.find((c) => c.name === `anthropic-fable-5.1${suffix}`)!
          .costPerUnitInUsdCents,
      );
    }
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "openai-gpt-6-astra-tokens-cached-input")!
        .costPerUnitInUsdCents,
    ).not.toBe(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-fable-5.1-tokens-cached-input")!
        .costPerUnitInUsdCents,
    );
  });

  it("marks every Astra line marked-up — LLM tokens are work we perform, not money we route", () => {
    for (const name of ASTRA_NAMES) {
      expect(SEED_PROVIDERS_COSTS.find((c) => c.name === name)!.pricingBasis).toBe("marked-up");
    }
  });

  it("carries no pricing regime — OpenAI publishes no time-of-day schedule", () => {
    for (const name of ASTRA_NAMES) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.pricingRegime).toBeUndefined();
      expect(row.regimeHoursUtc).toBeUndefined();
    }
  });

  it("declares an openai platform cost, so the first-ever OpenAI declaration resolves", () => {
    // Without this row every by-name read 500s `No platform cost configured for provider
    // 'openai'` — a cost row alone is not enough for a brand-new provider.
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "openai");
    expect(platform).toBeDefined();
    expect(SEED_PLATFORM_COSTS.filter((c) => c.provider === "openai")).toHaveLength(1);
    for (const name of ASTRA_NAMES) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });

  it("maps openai to a logo domain for the public pricing page", () => {
    expect(PROVIDER_DOMAINS.openai).toBe("openai.com");
  });

  it("declares each name exactly once — no second version competing with the launch price", () => {
    for (const name of ASTRA_NAMES) {
      expect(SEED_PROVIDERS_COSTS.filter((c) => c.name === name)).toHaveLength(1);
    }
  });

  it("adds no other openai row — the long-context tier is not seeded", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "openai").map((c) => c.name);
    expect(rows.sort()).toEqual([...ASTRA_NAMES].sort());
  });
});
