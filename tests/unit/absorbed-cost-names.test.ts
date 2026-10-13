import { describe, it, expect } from "vitest";
import { ABSORBED_COST_NAMES, isAbsorbedCostName } from "../../src/lib/absorbed-cost-names.js";
import { SEED_PROVIDERS_COSTS } from "../../src/db/seed.js";
import { RETIRED_COST_NAMES } from "../../src/lib/retired-cost-names.js";

const CARD_FEES = [
  "stripe-processing-fee",
  "stripe-refund-fee",
  "stripe-dispute-fee",
  "stripe-payout-failure-fee",
  "revolut-acquiring-fee",
];

describe("absorbed cost names (card-acquiring fees, owner 2026-10-13)", () => {
  it("declares exactly the five card-acquiring fees", () => {
    expect(Object.keys(ABSORBED_COST_NAMES).sort()).toEqual([...CARD_FEES].sort());
    for (const name of CARD_FEES) expect(isAbsorbedCostName(name), name).toBe(true);
    expect(isAbsorbedCostName("google-ads-spend")).toBe(false);
  });

  it("keeps every absorbed name seeded with a real non-null price (runs-service prices fee rows by name)", () => {
    for (const name of CARD_FEES) {
      const rows = SEED_PROVIDERS_COSTS.filter((r) => r.name === name);
      expect(rows.length, `${name} must stay seeded`).toBeGreaterThan(0);
      for (const r of rows) expect(r.costPerUnitInUsdCents, name).toBe("1.0000000000");
    }
  });

  it("is not a retirement (no successor: the fee still happens)", () => {
    for (const name of CARD_FEES) expect(RETIRED_COST_NAMES[name], name).toBeUndefined();
  });
});
