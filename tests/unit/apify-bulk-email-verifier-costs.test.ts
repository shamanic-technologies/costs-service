import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Email-VERIFICATION costs consumed by apify-service POST /verify (backed by the
// ryanclinton/bulk-email-verifier actor). runs-service 422-rejects any cost name
// absent from this catalog, so both must seed + resolve a price under the active
// apify/starter platform plan, exactly like the lead + actor-start costs.
const VERIFIER_COSTS = [
  {
    name: "apify-bulk-email-verifier-email",
    type: "Bulk Email Verifier email",
    unit: "email",
    raw: "0.5000000000", // real Apify $0.005/email = 0.5¢; charged 2× = 1¢
  },
  {
    name: "apify-bulk-email-verifier-actor-start",
    type: "Bulk Email Verifier actor start",
    unit: "run",
    raw: "0.0050000000", // real Apify $0.00005/run = 0.005¢; charged 2× = 0.01¢
  },
];

describe("Apify bulk-email-verifier unit costs", () => {
  for (const { name, type, unit, raw } of VERIFIER_COSTS) {
    it(`registers ${name} (${unit} unit, Bronze tier, Starter plan)`, () => {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name);
      expect(row).toBeDefined();
      expect(row!.provider).toBe("apify");
      expect(row!.providerDomain).toBe("apify.com");
      expect(row!.type).toBe(type);
      expect(row!.unit).toBe(unit);
      expect(row!.planTier).toBe("starter");
      expect(row!.billingCycle).toBe("monthly");
      // Stored value is 2× the raw provider cost (cost-risk markup).
      expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(raw));
    });

    it(`resolves ${name} against the active apify platform cost (plan_tier + billing_cycle match)`, () => {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "apify");
      expect(platform).toBeDefined();
      // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
      // Without a matching apify platform cost, GET /v1/platform-prices/<name> never returns a price.
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    });
  }
});
