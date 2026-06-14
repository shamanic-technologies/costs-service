import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Per-run actor-start fee for the pipelinelabs actor, billed alongside the per-lead
// event (apify-pipelinelabs-lead). runs-service 422-rejects any cost name absent from
// this catalog, so apify-service cannot declare the run-start cost until it seeds +
// resolves a price under the active apify/starter platform plan.
const NAME = "apify-pipelinelabs-actor-start";
const RAW = "0.0010000000"; // real Apify $0.00001/run = 0.001¢; charged 2× = 0.002¢

describe("Apify pipelinelabs actor-start unit cost", () => {
  it(`registers ${NAME} (run unit, Bronze tier, Starter plan)`, () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === NAME);
    expect(row).toBeDefined();
    expect(row!.provider).toBe("apify");
    expect(row!.providerDomain).toBe("apify.com");
    expect(row!.type).toBe("PipelineLabs actor start");
    expect(row!.unit).toBe("run");
    expect(row!.planTier).toBe("starter");
    expect(row!.billingCycle).toBe("monthly");
    // Stored value is 2× the raw provider cost (cost-risk markup): 0.001¢ → 0.002¢.
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
});
