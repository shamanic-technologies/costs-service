import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS, applyCostRiskMultiplier } from "../../src/db/seed.js";

// Cloudflare Workers AI model catalog (our account, read 2026-10-21):
//   @cf/cloudflare/clef $0.24 / 1M input tokens; @cf/cloudflare/clef-flash $0.038 / 1M input
//   tokens; output $0.00; no cache dimension, no long-context tier.
const CLEF = "cloudflare-clef-tokens-input";
const FLASH = "cloudflare-clef-flash-tokens-input";

const row = (name: string) => SEED_PROVIDERS_COSTS.find((c) => c.name === name);

describe("Cloudflare Workers AI Clef unit costs", () => {
  it("prices clef input at $0.24/1M tokens, marked up", () => {
    const r = row(CLEF)!;
    expect(r).toBeDefined();
    expect(r.provider).toBe("cloudflare");
    expect(r.unit).toBe("1M tokens");
    expect(r.pricingBasis).toBe("marked-up");
    expect(r.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000240000"));
  });

  it("prices clef-flash input at $0.038/1M tokens, marked up", () => {
    const r = row(FLASH)!;
    expect(r).toBeDefined();
    expect(r.provider).toBe("cloudflare");
    expect(r.pricingBasis).toBe("marked-up");
    expect(r.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000038000"));
  });

  it("seeds no output or cache row (the vendor charges none)", () => {
    const names = SEED_PROVIDERS_COSTS.map((c) => c.name).filter((n) => n.startsWith("cloudflare-clef"));
    expect(names.sort()).toEqual([FLASH, CLEF].sort());
  });

  it("resolves against the active cloudflare platform plan", () => {
    const plan = SEED_PLATFORM_COSTS.find((p) => p.provider === "cloudflare")!;
    for (const n of [CLEF, FLASH]) {
      expect(row(n)!.planTier).toBe(plan.planTier);
      expect(row(n)!.billingCycle).toBe(plan.billingCycle);
    }
  });
});
