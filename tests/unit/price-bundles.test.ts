import { describe, it, expect } from "vitest";
import { PRICE_BUNDLES, bundleOf } from "../../src/lib/price-bundles.js";
import { EMAIL_SEND_COST_SHARES } from "../../src/lib/price-lists.js";
import { costNameStatus } from "../../src/lib/retired-cost-names.js";

describe("price bundles (what a client pays per outcome)", () => {
  it("one email sent = the whole email send price: member shares x units per email sum to 1", () => {
    const email = PRICE_BUNDLES.find((b) => b.name === "email-sent")!;
    const total = email.members.reduce((s, m) => s + EMAIL_SEND_COST_SHARES[m.costName] * m.unitsPerBundle, 0);
    expect(total).toBe(1);
  });

  it("every bundle member is a current name", () => {
    for (const b of PRICE_BUNDLES) for (const m of b.members) expect(costNameStatus(m.costName).status).toBe("current");
  });

  it("prices one email at the sum of both rows (daegu-v2 report 2026-10-06: each row alone is half)", () => {
    const prices = new Map([
      ["instantly-account-email-sent", "2.9886000000"],
      ["instantly-domain-email-sent", "2.9886000000"],
    ]);
    expect(bundleOf("instantly-domain-email-sent", prices)).toEqual({
      name: "email-sent",
      unit: "email",
      members: ["instantly-account-email-sent", "instantly-domain-email-sent"],
      pricePerUnitInUsdCents: "5.9772000000",
    });
  });

  it("an unpriced member leaves the bundle unpriced, never a partial sum", () => {
    const prices = new Map([["instantly-account-email-sent", "2.9886000000"]]);
    expect(bundleOf("instantly-account-email-sent", prices)!.pricePerUnitInUsdCents).toBeNull();
  });

  it("a standalone name has no bundle", () => {
    expect(bundleOf("apollo-credit", new Map())).toBeNull();
  });
});
