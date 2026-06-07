import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Instantly email-send is priced on a domain-based model (warmed-mailbox model dropped):
// buy a domain ($20/yr), upload it to Instantly with 5 accounts; each account sends
// 20 emails/business-day × 252 days = 5,040 emails/yr. The per-email cost comes entirely
// from the domain, so it is plan-independent (Instantly email accounts are unlimited/free):
//   $20/yr ÷ 5 accounts ÷ 5,040 emails = $0.000793650794 = 0.0793650794¢/email.
// The domain line (instantly-domain-email-sent) is folded into the account line and kept
// at 0 to avoid double-counting.
describe("Instantly email-send unit costs (domain-based model)", () => {
  const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "instantly");

  it("has an active instantly platform cost (hypergrowth/monthly)", () => {
    expect(platform).toBeDefined();
    expect(platform!.planTier).toBe("hypergrowth");
    expect(platform!.billingCycle).toBe("monthly");
  });

  it("prices instantly-account-email-sent at 0.0793650794¢ base (×2 markup) on both tiers", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === "instantly-account-email-sent");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0793650794"));
      expect(row.provider).toBe("instantly");
      expect(row.unit).toBe("email");
    }
    expect(rows.map((r) => r.planTier).sort()).toEqual(["growth", "hypergrowth"]);
  });

  it("zeroes instantly-domain-email-sent (folded into account-email-sent) on both tiers", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === "instantly-domain-email-sent");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000000000"));
    }
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
