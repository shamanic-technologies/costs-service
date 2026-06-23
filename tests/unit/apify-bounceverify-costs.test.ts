import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Email-VERIFICATION cost consumed by apify-service POST /verify (backed by the
// bounceverify/bounceverify-email-verifier actor — real SMTP + catch-all on its
// own backend). Single PAY_PER_EVENT per-email fee, no actor-start. runs-service
// 422-rejects any cost name absent from this catalog, so it must seed + resolve a
// price under the active apify/starter platform plan.
const NAME = "apify-bounceverify-email";
const RAW = "0.0890000000"; // real Apify $0.00089/email = 0.089¢; charged 2× = 0.178¢

describe("Apify bounceverify unit cost", () => {
  it(`registers ${NAME} (email unit, Bronze tier, Starter plan)`, () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === NAME);
    expect(row).toBeDefined();
    expect(row!.provider).toBe("apify");
    expect(row!.providerDomain).toBe("apify.com");
    expect(row!.type).toBe("BounceVerify email");
    expect(row!.unit).toBe("email");
    expect(row!.planTier).toBe("starter");
    expect(row!.billingCycle).toBe("monthly");
    // Stored value is 2× the raw provider cost (cost-risk markup): 0.089¢ → 0.178¢.
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(RAW));
  });

  it(`resolves ${NAME} against the active apify platform cost (plan_tier + billing_cycle match)`, () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === NAME)!;
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "apify");
    expect(platform).toBeDefined();
    // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
    // Without a matching apify platform cost, GET /v1/platform-prices/<name> never returns a price.
    expect(row.planTier).toBe(platform!.planTier);
    expect(row.billingCycle).toBe(platform!.billingCycle);
  });

  it("retired the ryanclinton rows (single bounceverify cost, no actor-start)", () => {
    expect(SEED_PROVIDERS_COSTS.find((c) => c.name === "apify-bulk-email-verifier-email")).toBeUndefined();
    expect(SEED_PROVIDERS_COSTS.find((c) => c.name === "apify-bulk-email-verifier-actor-start")).toBeUndefined();
  });
});
