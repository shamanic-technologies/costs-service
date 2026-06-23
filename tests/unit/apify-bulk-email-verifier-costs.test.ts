import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Two PAY_PER_EVENT costs for the bulk-email-verifier actor (ryanclinton/bulk-email-verifier),
// declared by apify-service /verify: a per-email verified fee AND a per-run actor-start fee.
// runs-service 422-rejects any cost name absent from this catalog, so apify-service cannot
// provision /verify until both names seed + resolve a price under the active apify/starter plan.
const EMAIL = {
  name: "apify-bulk-email-verifier-email",
  type: "Bulk email verifier email",
  unit: "email",
  raw: "0.5000000000", // real Apify $0.005/email = 0.5¢; charged 2× = 1¢
};
const ACTOR_START = {
  name: "apify-bulk-email-verifier-actor-start",
  type: "Bulk email verifier actor start",
  unit: "run",
  raw: "0.0050000000", // real Apify $0.00005/run = 0.005¢; charged 2× = 0.01¢
};

describe("Apify bulk-email-verifier unit costs", () => {
  for (const c of [EMAIL, ACTOR_START]) {
    it(`registers ${c.name} (${c.unit} unit, Bronze tier, Starter plan)`, () => {
      const row = SEED_PROVIDERS_COSTS.find((r) => r.name === c.name);
      expect(row).toBeDefined();
      expect(row!.provider).toBe("apify");
      expect(row!.providerDomain).toBe("apify.com");
      expect(row!.type).toBe(c.type);
      expect(row!.unit).toBe(c.unit);
      expect(row!.planTier).toBe("starter");
      expect(row!.billingCycle).toBe("monthly");
      // Stored value is 2× the raw provider cost (cost-risk markup).
      expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(c.raw));
    });

    it(`resolves ${c.name} against the active apify platform cost (plan_tier + billing_cycle match)`, () => {
      const row = SEED_PROVIDERS_COSTS.find((r) => r.name === c.name)!;
      const platform = SEED_PLATFORM_COSTS.find((p) => p.provider === "apify");
      expect(platform).toBeDefined();
      // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
      // Without a matching apify platform cost, GET /v1/platform-prices/<name> never returns a price.
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    });
  }
});
