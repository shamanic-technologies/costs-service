import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS, noLongerBillable } from "../../src/db/seed.js";

// The cold-email infrastructure spend (Instantly subscriptions, MailForge, PrimeForge, the
// Claude Max seat) moved OFF the per-customer rebill and onto our own fixed costs in 2026-08,
// and instantly-service stopped declaring per-email spend. So these three names receive no new
// usage and must stop being advertised as a current price.
//
// They are DELISTED, not deleted and not zeroed:
//   - the seed declares a null price, which appends a null-priced version at deploy time and
//     leaves every prior priced row untouched (spend already declared reads back unchanged);
//   - a zero was rejected — it would assert the line is free, and it is not: we still pay for
//     the inboxes, we simply stopped passing that on;
//   - retiring the `instantly` PROVIDER was rejected too — these names have no newer row on
//     another provider, so dropping the platform-cost row would 500 every by-name read.
//
// MailForge and PrimeForge never carried catalog lines of their own (that infra was priced
// through the instantly-*-email-sent rows), so there is nothing else to delist.
const COLD_EMAIL_COST_NAMES = [
  "instantly-account-email-sent",
  "instantly-domain-email-sent",
  "instantly-contact-uploaded",
];

describe("Instantly cold-email infrastructure costs (delisted 2026-08)", () => {
  const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "instantly");

  it("keeps the instantly platform cost (hypergrowth/monthly) so the names stay resolvable", () => {
    // Without an active plan for the provider, /v1/platform-prices/:name and
    // /v1/providers-costs/:name 500 with "No platform cost configured for provider 'instantly'"
    // — the names would go dark instead of resolving for historical reads.
    expect(platform).toBeDefined();
    expect(platform!.planTier).toBe("hypergrowth");
    expect(platform!.billingCycle).toBe("monthly");
  });

  it.each(COLD_EMAIL_COST_NAMES)("%s is declared with no billable price", (name) => {
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).toBe(noLongerBillable());
      expect(row.provider).toBe("instantly");
    }
  });

  it.each(COLD_EMAIL_COST_NAMES)("%s is never priced at zero", (name) => {
    // A zero price would claim the line costs nothing. Absence of a price is the honest
    // representation of "we still pay for this, we just stopped charging for it".
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
    for (const row of rows) {
      expect(row.costPerUnitInUsdCents).not.toBe("0.0000000000");
      expect(row.costPerUnitInUsdCents).toBeNull();
    }
  });

  it.each(COLD_EMAIL_COST_NAMES)("%s is not deleted from the catalog", (name) => {
    // runs-service holds historical cost rows under these names and a reconcile sweep still
    // PATCHes old holds by cost id, so the name must remain declared.
    expect(SEED_PROVIDERS_COSTS.some((c) => c.name === name)).toBe(true);
  });

  it("delists both tiers, so no plan switch can resurrect a price", () => {
    for (const name of ["instantly-account-email-sent", "instantly-contact-uploaded"]) {
      const tiers = SEED_PROVIDERS_COSTS.filter((c) => c.name === name).map((c) => c.planTier);
      expect(tiers.sort()).toEqual(["growth", "hypergrowth"]);
    }
  });

  it("keeps a served row on the active platform plan for each delisted name", () => {
    for (const name of COLD_EMAIL_COST_NAMES) {
      const served = SEED_PROVIDERS_COSTS.find(
        (c) => c.name === name && c.planTier === platform!.planTier
      );
      expect(served, `${name} must have a row on the active plan tier`).toBeDefined();
    }
  });

  it("should not contain a legacy instantly-email-send name", () => {
    expect(SEED_PROVIDERS_COSTS.find((c) => c.name === "instantly-email-send")).toBeUndefined();
  });
});
