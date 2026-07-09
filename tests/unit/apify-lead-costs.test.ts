import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Per-actor verified-lead costs consumed by apify-service. runs-service 422-rejects
// any cost name absent from this catalog, so all three must seed + resolve a price
// under the active apify/starter platform plan.
const LEAD_COSTS = [
  { name: "apify-pipelinelabs-lead", type: "PipelineLabs lead", raw: "0.1000000000" },
  { name: "apify-microworlds-lead", type: "MicroWorlds lead", raw: "0.1600000000" },
  { name: "apify-clearpath-lead", type: "ClearPath lead", raw: "1.5000000000" },
];

describe("Apify per-actor lead unit costs", () => {
  for (const { name, type, raw } of LEAD_COSTS) {
    it(`registers ${name} (lead unit, Bronze tier, Starter plan)`, () => {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name);
      expect(row).toBeDefined();
      expect(row!.provider).toBe("apify");
      expect(row!.providerDomain).toBe("apify.com");
      expect(row!.type).toBe(type);
      expect(row!.unit).toBe("lead");
      expect(row!.planTier).toBe("starter");
      expect(row!.billingCycle).toBe("monthly");
      // Stored value is 4× the raw provider cost (risk × profit markup).
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
