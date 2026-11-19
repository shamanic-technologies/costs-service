import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Amazon SES email send unit cost", () => {
  it("registers ses-email-send at the AWS list price $0.10 per 1,000 emails, marked up", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "ses-email-send");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("aws-ses");
    expect(row!.providerDomain).toBe("aws.amazon.com");
    expect(row!.type).toBe("Email send");
    expect(row!.unit).toBe("email");
    expect(row!.pricingBasis).toBe("marked-up");
    // $0.0001 = 0.01¢ vendor rate, stored x COST_DEFAULT_MULTIPLIER.
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0100000000"));
  });

  it("resolves against the active aws-ses platform cost (plan_tier + billing_cycle match)", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "ses-email-send")!;
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "aws-ses");
    expect(platform).toBeDefined();
    expect(row.planTier).toBe(platform!.planTier);
    expect(row.billingCycle).toBe(platform!.billingCycle);
  });
});
