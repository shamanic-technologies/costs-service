import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Vendor table, from https://docs.x.com/x-api/getting-started/pricing (read 2026-10-02):
//   Post: Create $0.015 per request (pay-per-use). Consumer: social-service, quantity = 1 per reply.
const NAME = "x-post-create";

describe("X API post create cost (new direct vendor)", () => {
  it("registers x-post-create at $0.015 (1.5 cents) per post, marked up", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === NAME);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.provider).toBe("x");
    expect(row.providerDomain).toBe("x.com");
    expect(row.type).toBe("X API v2 post create (pay-per-use)");
    expect(row.unit).toBe("post");
    expect(row.planTier).toBe("pay-as-you-go");
    expect(row.billingCycle).toBe("monthly");
    expect(row.pricingBasis).toBe("marked-up");
    expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("1.5000000000"));
  });

  it("is a different provider from x-ads (routed ad spend)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === NAME)!;
    expect(row.provider).not.toBe("x-ads");
  });

  it("declares an x platform cost whose plan matches, so the by-name read resolves", () => {
    const platform = SEED_PLATFORM_COSTS.filter((c) => c.provider === "x");
    expect(platform).toHaveLength(1);
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === NAME)!;
    expect(row.planTier).toBe(platform[0].planTier);
    expect(row.billingCycle).toBe(platform[0].billingCycle);
  });

  it("maps x to a logo domain", () => {
    expect(PROVIDER_DOMAINS.x).toBe("x.com");
  });
});
