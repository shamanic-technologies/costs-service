import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Instantly email-send is priced on the Mailforge-provisioned infra model:
// a domain costs $26/yr shared by 2 accounts, each account costs $3/mo = $36/yr.
// Each account sends 20 emails/business-day × 252 days = 5,040 emails/yr. The cost is
// SPLIT across the two rows (they sum to the real per-email cost, no folding/zeroing):
//   account = $36/yr ÷ 5,040 emails              = 0.7142857143¢/email
//   domain  = $26/yr ÷ (5,040 emails × 2 accts)  = 0.2579365079¢/email
//   total                                        = 0.9722222222¢/email (×2 markup at store).
describe("Instantly email-send unit costs (Mailforge infra model)", () => {
  const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "instantly");

  it("has an active instantly platform cost (hypergrowth/monthly)", () => {
    expect(platform).toBeDefined();
    expect(platform!.planTier).toBe("hypergrowth");
    expect(platform!.billingCycle).toBe("monthly");
  });

  it("prices instantly-account-email-sent at 0.7142857143¢ base (×2 markup) on both tiers", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === "instantly-account-email-sent");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.7142857143"));
      expect(row.provider).toBe("instantly");
      expect(row.unit).toBe("email");
    }
    expect(rows.map((r) => r.planTier).sort()).toEqual(["growth", "hypergrowth"]);
  });

  it("prices instantly-domain-email-sent at 0.2579365079¢ base (×2 markup) on both tiers", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === "instantly-domain-email-sent");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.2579365079"));
      expect(row.provider).toBe("instantly");
      expect(row.unit).toBe("email");
    }
    expect(rows.map((r) => r.planTier).sort()).toEqual(["growth", "hypergrowth"]);
  });

  // account + domain on the same tier must sum to the full per-email cost (no folding):
  //   0.7142857143 + 0.2579365079 = 0.9722222222¢ base.
  it("account + domain rows sum to the full per-email cost on the served tier", () => {
    const account = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "instantly-account-email-sent" && c.planTier === platform!.planTier
    );
    const domain = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "instantly-domain-email-sent" && c.planTier === platform!.planTier
    );
    expect(account).toBeDefined();
    expect(domain).toBeDefined();
    const sum =
      Number(account!.costPerUnitInUsdCents) + Number(domain!.costPerUnitInUsdCents);
    expect(sum).toBeCloseTo(Number(applyCostRiskMultiplier("0.9722222222")), 9);
  });

  // Guard: the served row must match the active platform cost on (planTier, billingCycle),
  // otherwise GET /v1/platform-prices/instantly-account-email-sent 404s. Fails red if the
  // platform row is ever removed or the tiers drift apart (mirrors apify-ahrefs-costs.test.ts).
  it("the served account-email-sent row matches the active platform cost", () => {
    const served = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "instantly-account-email-sent" && c.planTier === platform!.planTier
    );
    expect(served).toBeDefined();
    expect(served!.billingCycle).toBe(platform!.billingCycle);
  });

  it("the served domain-email-sent row matches the active platform cost", () => {
    const served = SEED_PROVIDERS_COSTS.find(
      (c) => c.name === "instantly-domain-email-sent" && c.planTier === platform!.planTier
    );
    expect(served).toBeDefined();
    expect(served!.billingCycle).toBe(platform!.billingCycle);
  });
});
