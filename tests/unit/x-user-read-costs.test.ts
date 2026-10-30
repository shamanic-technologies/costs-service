import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS, applyCostRiskMultiplier } from "../../src/db/seed.js";

// Vendor table, https://docs.x.com/x-api/getting-started/pricing (read 2026-10-30): User: Read $0.010
// per resource. Consumer: social-service, 1 per GET /2/users/me on an X account connect (X-ACCOUNTS-1030).
const NAME = "x-user-read";

describe("X API user read cost", () => {
  it("registers x-user-read at $0.010 (1 cent) per user, marked up", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === NAME);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.provider).toBe("x");
    expect(row.providerDomain).toBe("x.com");
    expect(row.unit).toBe("user");
    expect(row.pricingBasis).toBe("marked-up");
    expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("1.0000000000"));
  });

  it("matches the x platform cost plan, so the by-name read resolves", () => {
    const platform = SEED_PLATFORM_COSTS.filter((c) => c.provider === "x");
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === NAME)!;
    expect(row.planTier).toBe(platform[0].planTier);
    expect(row.billingCycle).toBe(platform[0].billingCycle);
  });
});
