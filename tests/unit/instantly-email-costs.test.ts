import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Instantly email-send is priced on the prewarmed-inbox infra model (2026-07):
// a domain is bought $15/yr and hosts 5 prewarmed accounts at $10/mo each; each account
// sends 30 emails/business-day × 252 days = 7,560/yr. A $47/mo global deliverability tool
// ($564/yr) is amortised over the whole fleet (30 domains × 5 = 150 accounts × 7,560 =
// 1,134,000 sends/yr) and FOLDED into the account row (option B — no separate cost name):
//   account = $120/yr hosting ÷ 7,560 + $564/yr deliverability ÷ 1,134,000
//           = 1.5873015873 + 0.0497354497        = 1.6370370370¢/email
//   domain  = $15/yr ÷ (7,560 × 5 accounts = 37,800) = 0.0396825397¢/email
//   total                                        = 1.6767195767¢/email (×2 markup at store).
describe("Instantly email-send unit costs (prewarmed-inbox infra model)", () => {
  const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "instantly");

  it("has an active instantly platform cost (hypergrowth/monthly)", () => {
    expect(platform).toBeDefined();
    expect(platform!.planTier).toBe("hypergrowth");
    expect(platform!.billingCycle).toBe("monthly");
  });

  it("prices instantly-account-email-sent at 1.6370370370¢ base (×2 markup) on both tiers", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === "instantly-account-email-sent");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("1.6370370370"));
      expect(row.provider).toBe("instantly");
      expect(row.unit).toBe("email");
    }
    expect(rows.map((r) => r.planTier).sort()).toEqual(["growth", "hypergrowth"]);
  });

  it("prices instantly-domain-email-sent at 0.0396825397¢ base (×2 markup) on both tiers", () => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === "instantly-domain-email-sent");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0396825397"));
      expect(row.provider).toBe("instantly");
      expect(row.unit).toBe("email");
    }
    expect(rows.map((r) => r.planTier).sort()).toEqual(["growth", "hypergrowth"]);
  });

  // account + domain on the same tier must sum to the full per-email cost:
  //   1.6370370370 + 0.0396825397 = 1.6767195767¢ base (deliverability folded into account).
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
    expect(sum).toBeCloseTo(Number(applyCostRiskMultiplier("1.6767195767")), 9);
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
