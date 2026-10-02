import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Vendor table, from https://docs.x.com/x-api/getting-started/pricing (read 2026-10-02):
//   Post: Create (with URL) $0.200 per request (pay-per-use).
// Consumer: social-service, quantity = 1 per quote-repost (original post URL in the text).
const NAME = "x-post-create-with-url";

describe("X API post create with URL cost", () => {
  it("registers x-post-create-with-url at $0.20 (20 cents) per post, marked up", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === NAME);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.provider).toBe("x");
    expect(row.providerDomain).toBe("x.com");
    expect(row.type).toBe("X API v2 post create with URL (pay-per-use)");
    expect(row.unit).toBe("post");
    expect(row.planTier).toBe("pay-as-you-go");
    expect(row.billingCycle).toBe("monthly");
    expect(row.pricingBasis).toBe("marked-up");
    expect(row.effectiveFrom.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("20.0000000000"));
  });

  it("is priced above the plain post (X charges URL posts more)", () => {
    const plain = SEED_PROVIDERS_COSTS.find((c) => c.name === "x-post-create")!;
    const withUrl = SEED_PROVIDERS_COSTS.find((c) => c.name === NAME)!;
    expect(Number(withUrl.costPerUnitInUsdCents)).toBeGreaterThan(Number(plain.costPerUnitInUsdCents));
    expect(withUrl.provider).toBe(plain.provider);
  });

  it("matches the x platform cost plan, so the by-name read resolves", () => {
    const platform = SEED_PLATFORM_COSTS.filter((c) => c.provider === "x");
    expect(platform).toHaveLength(1);
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === NAME)!;
    expect(row.planTier).toBe(platform[0].planTier);
    expect(row.billingCycle).toBe(platform[0].billingCycle);
  });
});
