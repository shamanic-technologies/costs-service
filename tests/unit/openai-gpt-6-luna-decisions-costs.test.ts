import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS, applyCostRiskMultiplier } from "../../src/db/seed.js";

// OpenAI Decisions API, gpt-6-luna (guide + model page read 2026-10-21):
//   input $0.10 / 1M tokens; no cache-read, cache-write or output charges;
//   prompts over 272K input tokens: 2x input for the full request.
const NORMAL = "openai-gpt-6-luna-decisions-tokens-input";
const LONG = "openai-gpt-6-luna-decisions-long-context-tokens-input";

const row = (name: string) => SEED_PROVIDERS_COSTS.find((c) => c.name === name);

describe("OpenAI GPT-6 Luna Decisions API unit costs", () => {
  it("prices normal input at $0.10/1M tokens, marked up", () => {
    const r = row(NORMAL)!;
    expect(r).toBeDefined();
    expect(r.provider).toBe("openai");
    expect(r.unit).toBe("1M tokens");
    expect(r.pricingBasis).toBe("marked-up");
    expect(r.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000100000"));
  });

  it("prices long-context input at 2x ($0.20/1M tokens)", () => {
    const r = row(LONG)!;
    expect(r).toBeDefined();
    expect(r.provider).toBe("openai");
    expect(r.pricingBasis).toBe("marked-up");
    expect(r.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000200000"));
  });

  it("seeds no output or cache row for the Decisions API (the vendor charges none)", () => {
    const names = SEED_PROVIDERS_COSTS.map((c) => c.name).filter((n) => n.includes("luna-decisions"));
    expect(names.sort()).toEqual([LONG, NORMAL].sort());
  });

  it("never collides with a plain chat gpt-6-luna name", () => {
    expect(SEED_PROVIDERS_COSTS.some((c) => c.name.startsWith("openai-gpt-6-luna-tokens-"))).toBe(false);
  });

  it("resolves against the active openai platform plan", () => {
    const plan = SEED_PLATFORM_COSTS.find((p) => p.provider === "openai")!;
    for (const n of [NORMAL, LONG]) {
      expect(row(n)!.planTier).toBe(plan.planTier);
      expect(row(n)!.billingCycle).toBe(plan.billingCycle);
    }
  });
});
