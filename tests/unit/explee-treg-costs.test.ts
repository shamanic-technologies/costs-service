import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Two email-finder vendors human-service benchmarks against Apollo, calling them with the
// platform keys and declaring spend through runs-service — which 422-rejects any cost name
// this catalog does not know. Both are brand-new providers, so each also needs its own
// SEED_PLATFORM_COSTS row or GET /v1/platform-prices/<name> 500s.
const cases = [
  {
    name: "explee-credit",
    provider: "explee",
    domain: "explee.com",
    unit: "credit",
    planTier: "starter",
    // Starter: $49 / 5,000 credits = 0.98¢ per credit (https://explee.com/pricing).
    raw: "0.9800000000",
  },
  {
    name: "treg-micro-usd",
    provider: "treg",
    domain: "treg.to",
    unit: "micro-USD",
    planTier: "pay-as-you-go",
    // Quantity = the integer micro-USD treg reports in X-Treg-Cost-Micro. 1 µUSD = 0.0001¢.
    raw: "0.0001000000",
  },
];

describe("Explee + treg email-finder costs", () => {
  for (const c of cases) {
    it(`registers ${c.name} as a marked-up line`, () => {
      const row = SEED_PROVIDERS_COSTS.find((r) => r.name === c.name);
      expect(row).toBeDefined();
      expect(row!.provider).toBe(c.provider);
      expect(row!.providerDomain).toBe(c.domain);
      expect(row!.unit).toBe(c.unit);
      expect(row!.planTier).toBe(c.planTier);
      expect(row!.billingCycle).toBe("monthly");
      expect(row!.pricingBasis).toBe("marked-up");
      expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(c.raw));
    });

    it(`resolves ${c.name} against an active ${c.provider} platform cost`, () => {
      const row = SEED_PROVIDERS_COSTS.find((r) => r.name === c.name)!;
      const platform = SEED_PLATFORM_COSTS.find((p) => p.provider === c.provider);
      expect(platform).toBeDefined();
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    });
  }

  // Decimal-scale sanity against a sibling whose real price is known: $1 of treg spend
  // (1,000,000 µUSD) must cost exactly what $1 of any other marked-up vendor spend costs,
  // i.e. 100¢ × markup. apollo-credit is $0.0236/credit, so 1/0.0236 credits = $1 too.
  it("prices $1 of treg spend at the same stored figure as $1 of Apollo credits", () => {
    const treg = Number(SEED_PROVIDERS_COSTS.find((r) => r.name === "treg-micro-usd")!.costPerUnitInUsdCents);
    const apollo = Number(SEED_PROVIDERS_COSTS.find((r) => r.name === "apollo-credit")!.costPerUnitInUsdCents);
    const tregPerDollar = treg * 1_000_000;
    const apolloPerDollar = apollo / 2.36 * 100;
    expect(tregPerDollar).toBeCloseTo(apolloPerDollar, 6);
    expect(tregPerDollar).toBeCloseTo(Number(applyCostRiskMultiplier("100.0000000000")), 6);
  });

  it("prices an Explee premium email find (5 credits) at 5 × $0.0098 marked up", () => {
    const explee = Number(SEED_PROVIDERS_COSTS.find((r) => r.name === "explee-credit")!.costPerUnitInUsdCents);
    expect(explee * 5).toBeCloseTo(Number(applyCostRiskMultiplier("4.9000000000")), 8);
  });
});
