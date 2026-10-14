import { describe, it, expect } from "vitest";
import { CatalogueHistory, type CatalogueVersion } from "../../src/lib/catalogue-history.js";
import { realCostSeries } from "../../src/lib/real-cost.js";
import { planCatalogueSync } from "../../src/lib/catalogue-sync.js";
import { EMAIL_SEND_COST_SHARES, EMAIL_VERDICTS, emailVerdictOf } from "../../src/lib/price-lists.js";
import { PRICE_BUNDLES, bundleOf } from "../../src/lib/price-bundles.js";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS } from "../../src/db/seed.js";
import { costNameStatus } from "../../src/lib/retired-cost-names.js";

// Owner 2026-10-14: « Le prix qu'on a donné et qu'on calcule aujourd'hui doit correspondre aux valid
// [...] Si un user nous utilise pour un catch all, on x2 ce prix dans notre catalogue. Si un unknown
// on x3. » invalid, risky and no verdict are never sent: no price.
const VERDICT_NAMES = [
  "instantly-account-email-sent-catch-all",
  "instantly-domain-email-sent-catch-all",
  "instantly-account-email-sent-unknown",
  "instantly-domain-email-sent-unknown",
];

const T0 = new Date("2026-10-14T00:00:00Z");
const NOW = new Date("2026-10-14T12:00:00Z");
const DAY = "2026-10-14";
const v = (name: string): CatalogueVersion => ({
  name,
  provider: "instantly",
  planTier: "hypergrowth",
  billingCycle: "monthly",
  unit: "email",
  pricingBasis: "marked-up",
  price: null,
  vendorCost: null,
  effectiveFrom: T0,
  createdAt: T0,
});
const catalogue = () =>
  new CatalogueHistory(
    ["instantly-account-email-sent", "instantly-domain-email-sent", ...VERDICT_NAMES].map(v),
    [{ provider: "instantly", planTier: "hypergrowth", billingCycle: "monthly", effectiveFrom: T0 }],
  );

describe("email-sent price per BounceVerify verdict (owner 2026-10-14)", () => {
  it("declares x1 valid, x2 catch_all, x3 unknown, and nothing for invalid / risky / no verdict", () => {
    expect(EMAIL_VERDICTS.map((x) => [x.verdict, x.priceMultipleOfValid])).toEqual([
      ["valid", 1],
      ["catch_all", 2],
      ["unknown", 3],
    ]);
    expect(emailVerdictOf("instantly-account-email-sent")!.verdict).toBe("valid");
    expect(emailVerdictOf("instantly-domain-email-sent-catch-all")!.verdict).toBe("catch_all");
    expect(emailVerdictOf("instantly-account-email-sent-unknown")!.verdict).toBe("unknown");
    for (const no of ["invalid", "risky", "none"]) {
      expect(emailVerdictOf(`instantly-account-email-sent-${no}`)).toBeNull();
      expect(SEED_PROVIDERS_COSTS.some((c) => c.name.endsWith(`-${no}`) && c.name.startsWith("instantly-"))).toBe(false);
    }
  });

  it("each verdict's two names split one email 50/50, like the valid names", () => {
    for (const n of VERDICT_NAMES) expect(EMAIL_SEND_COST_SHARES[n], n).toBe(0.5);
  });

  it("worked example: valid $0.0573/email -> catch_all $0.1146, unknown $0.1719; real cost the same for all", () => {
    // Email send price 2.865 cents real -> valid 5.73 cents billed (x2).
    const series = realCostSeries({ days: [DAY], catalogue: catalogue(), now: NOW, emailPriceByDay: new Map([[DAY, 2.865]]), costPerCreditByDay: new Map() });
    const at = (n: string) => series.find((r) => r.costName === n)!;
    const perEmail = (suffix: string) => at(`instantly-account-email-sent${suffix}`).proposedPrice! + at(`instantly-domain-email-sent${suffix}`).proposedPrice!;
    expect(perEmail("")).toBeCloseTo(5.73, 10);
    expect(perEmail("-catch-all")).toBeCloseTo(11.46, 10);
    expect(perEmail("-unknown")).toBeCloseTo(17.19, 10);
    for (const n of VERDICT_NAMES) expect(at(n).realCost).toBe(at("instantly-account-email-sent").realCost);
    expect(at("instantly-account-email-sent")).toMatchObject({ multiplier: 2, proposedBasis: "real-cost-x2" });
    expect(at("instantly-account-email-sent-catch-all")).toMatchObject({ multiplier: 4, proposedBasis: "real-cost-x2-verdict-multiple" });
    expect(at("instantly-account-email-sent-unknown")).toMatchObject({ multiplier: 6, proposedBasis: "real-cost-x2-verdict-multiple" });
  });

  it("a change of the valid price moves all three (the multiple is stated, not a frozen number)", () => {
    const series = realCostSeries({ days: [DAY], catalogue: catalogue(), now: NOW, emailPriceByDay: new Map([[DAY, 4]]), costPerCreditByDay: new Map() });
    const p = (n: string) => series.find((r) => r.costName === n)!.proposedPrice!;
    expect(p("instantly-account-email-sent")).toBe(4);
    expect(p("instantly-account-email-sent-catch-all")).toBe(8);
    expect(p("instantly-account-email-sent-unknown")).toBe(12);
  });

  it("the sync bills each verdict name from its null seed version (no seed price ever billed)", () => {
    const series = realCostSeries({ days: [DAY], catalogue: catalogue(), now: NOW, emailPriceByDay: new Map([[DAY, 2.865]]), costPerCreditByDay: new Map() });
    const items = series.map((r) => ({
      costName: r.costName,
      method: r.method,
      flag: r.flag,
      proposedBasis: r.proposedBasis,
      proposedPriceUsdCents: r.proposedPrice === null ? null : r.proposedPrice.toFixed(10),
      realCostUsdCents: r.realCost === null ? null : r.realCost.toFixed(10),
    }));
    const plan = planCatalogueSync(items, catalogue(), NOW);
    const w = new Map(plan.writes.map((x) => [x.costName, x]));
    expect(w.get("instantly-account-email-sent-catch-all")!.priceUsdCents).toBe("5.7300000000");
    expect(w.get("instantly-domain-email-sent-unknown")!.priceUsdCents).toBe("8.5950000000");
    expect(w.get("instantly-account-email-sent-unknown")!.vendorCostDerivation).toBe("proposed-list-real-cost");
  });

  it("serves one bundle per verdict, labelled with the verdict AND BounceVerify", () => {
    const prices = new Map([
      ["instantly-account-email-sent", "2.8650000000"],
      ["instantly-domain-email-sent", "2.8650000000"],
      ["instantly-account-email-sent-catch-all", "5.7300000000"],
      ["instantly-domain-email-sent-catch-all", "5.7300000000"],
      ["instantly-account-email-sent-unknown", "8.5950000000"],
      ["instantly-domain-email-sent-unknown", "8.5950000000"],
    ]);
    expect(bundleOf("instantly-account-email-sent-catch-all", prices)).toEqual({
      name: "email-sent-catch-all",
      unit: "email",
      members: ["instantly-account-email-sent-catch-all", "instantly-domain-email-sent-catch-all"],
      pricePerUnitInUsdCents: "11.4600000000",
      label: "Email sent, address verified catch-all by BounceVerify",
      emailVerification: { provider: "BounceVerify", verdict: "catch_all", priceMultipleOfValid: 2, validBundle: "email-sent" },
    });
    expect(bundleOf("instantly-domain-email-sent-unknown", prices)).toMatchObject({
      name: "email-sent-unknown",
      pricePerUnitInUsdCents: "17.1900000000",
      label: "Email sent, address verified unknown by BounceVerify",
    });
    expect(bundleOf("instantly-domain-email-sent", prices)!.label).toBe("Email sent, address verified valid by BounceVerify");
    expect(PRICE_BUNDLES.map((b) => b.name)).toEqual(["email-sent", "email-sent-catch-all", "email-sent-unknown"]);
  });

  it("seeds every verdict name on the instantly plan in force, current, priced only by the proposed list", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "instantly")!;
    for (const n of VERDICT_NAMES) {
      const rows = SEED_PROVIDERS_COSTS.filter((c) => c.name === n);
      expect(rows, n).toHaveLength(1);
      expect(rows[0]).toMatchObject({ provider: "instantly", planTier: platform.planTier, billingCycle: platform.billingCycle, unit: "email", pricingBasis: "marked-up", costPerUnitInUsdCents: null });
      expect(rows[0].type).toMatch(/BounceVerify/);
      expect(costNameStatus(n).status).toBe("current");
    }
  });
});
