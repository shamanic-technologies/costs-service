import { describe, it, expect } from "vitest";
import { CatalogueHistory, endOfDay, type CatalogueVersion } from "../../src/lib/catalogue-history.js";
import { paygRatios, realCostSeries } from "../../src/lib/real-cost.js";
import { compare, compareByGroup, periodOf, type ConsumptionRow } from "../../src/lib/price-comparison.js";
import { PAY_AS_YOU_GO_VENDORS, PROPOSED_MULTIPLIER, PASS_THROUGH_MULTIPLIER, EMAIL_SEND_COST_SHARES, matchesPrefix } from "../../src/lib/price-lists.js";
import { SUBSCRIPTIONS } from "../../src/lib/subscriptions.js";

const T0 = new Date("2025-01-01T00:00:00Z");
const v = (name: string, provider: string, price: number | null, vendorCost: number | null, extra: Partial<CatalogueVersion> = {}): CatalogueVersion => ({
  name,
  provider,
  planTier: "p",
  billingCycle: "monthly",
  unit: "u",
  pricingBasis: "marked-up",
  price,
  vendorCost,
  effectiveFrom: T0,
  createdAt: T0,
  ...extra,
});
const plan = (provider: string) => ({ provider, planTier: "p", billingCycle: "monthly", effectiveFrom: T0 });
const NOW = new Date("2026-01-03T12:00:00Z");
const DAYS = ["2026-01-01", "2026-01-02", "2026-01-03"];

function catalogue() {
  return new CatalogueHistory(
    [
      v("anthropic-tokens", "anthropic", 0.0005, 0.0001),
      v("apollo-credit", "apollo", 11.8, 2.36),
      v("apollo-export-credit", "apollo", 1, 0.2),
      v("explee-credit", "explee", 5, 1),
      v("stripe-processing-fee", "stripe", 1, 1, { pricingBasis: "pass-through" }),
      v("instantly-account-email-sent", "instantly", null, null),
      v("zai-tokens", "zai", 0.001, 0.0002),
      v("google-flash-3-tokens-input", "zai", 0.001, 0.0002),
      v("instantly-contact-uploaded", "instantly", null, null),
      // repriced on 2026-01-02: the new version wins from that day
      v("zai-tokens", "zai", 0.002, 0.0004, { effectiveFrom: new Date("2026-01-02T00:00:00Z"), createdAt: new Date("2026-01-02T00:00:00Z") }),
    ],
    ["anthropic", "apollo", "explee", "stripe", "instantly", "zai"].map(plan),
  );
}

describe("price lists — owner declarations (2026-10-01)", () => {
  it("multiplier 2 for production tools, 1 for Stripe and media", () => {
    expect(PROPOSED_MULTIPLIER).toBe(2);
    expect(PASS_THROUGH_MULTIPLIER).toBe(1);
  });

  it("splits one email's price across the two names recorded per email", () => {
    expect(EMAIL_SEND_COST_SHARES["instantly-account-email-sent"] + EMAIL_SEND_COST_SHARES["instantly-domain-email-sent"]).toBe(1);
    expect(EMAIL_SEND_COST_SHARES["instantly-email-send"]).toBe(1);
  });

  it("never declares a subscription provider as pay-as-you-go", () => {
    const subs = new Set(SUBSCRIPTIONS.map((s) => s.provider));
    for (const p of PAY_AS_YOU_GO_VENDORS) expect(subs.has(p.provider), p.provider).toBe(false);
  });

  it("matches a ledger prefix on whole words only", () => {
    expect(matchesPrefix("google cloud rxxsxl", "google cloud")).toBe(true);
    expect(matchesPrefix("google cloud", "google cloud")).toBe(true);
    expect(matchesPrefix("google cloudy", "google cloud")).toBe(false);
  });
});

describe("catalogue history", () => {
  it("serves the version in force at the day's end, never a future one", () => {
    const c = catalogue();
    expect(c.versionAt("zai-tokens", endOfDay("2026-01-01", NOW)).version!.price).toBe(0.001);
    expect(c.versionAt("zai-tokens", endOfDay("2026-01-02", NOW)).version!.price).toBe(0.002);
    expect(c.versionAt("nope", NOW).reason).toBe("not-in-catalogue");
  });
});

describe("real cost per unit and proposed price", () => {
  const c = catalogue();
  const netPaid = new Map([["anthropic", new Map([["2026-01-02", 300]])]]);
  const ratios = paygRatios(DAYS, netPaid, [{ day: "2026-01-01", costName: "anthropic-tokens", quantity: 1_000_000 }], c, NOW);
  const series = realCostSeries({
    days: DAYS,
    catalogue: c,
    now: NOW,
    emailPriceByDay: new Map([["2026-01-03", 3]]),
    costPerCreditByDay: new Map([
      ["apollo", new Map([["2026-01-03", 2.9]])],
      ["explee", new Map<string, number | null>([["2026-01-03", null]])],
    ]),
    ratios,
  });
  const at = (day: string, name: string) => series.find((r) => r.day === day && r.costName === name)!;

  it("pay-as-you-go: catalogue vendor cost x (net paid / vendor cost recorded), x2", () => {
    // recorded 1,000,000 x 0.0001 = 100 cents; paid 300 cents on day 2 -> ratio 3
    expect(ratios.get("anthropic")!.get("2026-01-02")).toEqual({ cumulativeNetPaidUsdCents: 300, cumulativeVendorRecordedUsdCents: 100, ratio: 3 });
    expect(at("2026-01-02", "anthropic-tokens")).toMatchObject({ method: "pay-as-you-go-ratio", ratio: 3, realCost: 0.0003, proposedPrice: 0.0006, proposedBasis: "real-cost-x2", flag: null });
  });

  it("pay-as-you-go before any payment: catalogue vendor cost, flagged", () => {
    expect(at("2026-01-01", "anthropic-tokens")).toMatchObject({ method: "catalogue-vendor-cost", flag: "no-payment-yet", realCost: 0.0001, proposedPrice: 0.0002 });
  });

  it("subscription credit: the real cost per credit; a non-credit name of the vendor keeps its vendor cost, flagged", () => {
    expect(at("2026-01-03", "apollo-credit")).toMatchObject({ method: "subscription", realCost: 2.9, proposedPrice: 5.8 });
    expect(at("2026-01-03", "apollo-export-credit")).toMatchObject({ flag: "not-a-subscription-credit", realCost: 0.2, proposedPrice: 0.4 });
  });

  it("subscription with no real cost per credit (Explee) keeps its current price, flagged", () => {
    expect(at("2026-01-03", "explee-credit")).toMatchObject({ flag: "no-real-cost-per-credit", proposedPrice: 5, proposedBasis: "current-price-kept" });
  });

  it("a subscription credit the catalogue never carried still gets its real cost per credit (apollo-enrichment-credit)", () => {
    expect(at("2026-01-03", "apollo-enrichment-credit")).toMatchObject({ method: "subscription", realCost: 2.9, proposedPrice: 5.8, cataloguePrice: null });
    expect(at("2026-01-01", "apollo-enrichment-credit")).toMatchObject({ realCost: null, proposedBasis: "no-price" });
  });

  it("prices every legacy name runs-service recorded: successor, pre-split email, units included at the vendor", () => {
    expect(at("2026-01-01", "gemini-3-flash-tokens-input")).toMatchObject({ flag: "legacy-name-priced-as-successor", realCost: 0.0002, proposedPrice: 0.0004 });
    expect(at("2026-01-03", "instantly-email-send")).toMatchObject({ method: "email-send-price", realCost: 3, proposedPrice: 6 });
    expect(at("2026-01-03", "apollo-search-credit")).toMatchObject({ method: "included-at-vendor", flag: "included-in-another-cost", realCost: 0, proposedPrice: 0 });
    expect(at("2026-01-03", "instantly-contact-uploaded")).toMatchObject({ method: "included-at-vendor", realCost: 0, proposedPrice: 0 });
  });

  it("Stripe (pass-through) is proposed at its real cost x1", () => {
    expect(at("2026-01-03", "stripe-processing-fee")).toMatchObject({ method: "pass-through", realCost: 1, multiplier: 1, proposedPrice: 1, proposedBasis: "real-cost-x1" });
  });

  it("email infrastructure: half the email send price per name, x2; before any email, no real cost and no price", () => {
    expect(at("2026-01-03", "instantly-account-email-sent")).toMatchObject({ method: "email-send-price", realCost: 1.5, proposedPrice: 3 });
    expect(at("2026-01-01", "instantly-account-email-sent")).toMatchObject({ flag: "no-email-sent-yet", realCost: null, proposedPrice: null, proposedBasis: "no-price" });
  });

  it("a provider with no ledger line keeps its catalogue vendor cost, flagged, read on each day's version", () => {
    expect(at("2026-01-01", "zai-tokens")).toMatchObject({ flag: "no-ledger-line", realCost: 0.0002, proposedPrice: 0.0004 });
    expect(at("2026-01-03", "zai-tokens")).toMatchObject({ realCost: 0.0004, proposedPrice: 0.0008 });
  });
});

describe("price comparison", () => {
  const row = (day: string, costName: string, quantity: number, billed: number, extra: Partial<ConsumptionRow> = {}): ConsumptionRow => ({
    day,
    orgId: "o1",
    costName,
    costSource: "platform",
    quantity,
    billed,
    netBilled: billed * 0.9,
    ...extra,
  });
  const rows = [
    row("2026-03-02", "a", 10, 50),
    row("2026-03-09", "a", 10, 50, { orgId: "o2" }),
    row("2026-04-01", "b", 4, 8, { costSource: "org" }),
  ];
  const price1 = new Map<string, number | null>([["a", 5], ["b", 2]]);
  const realCost = new Map<string, number | null>([["2026-03-02|a", 1], ["2026-03-09|a", 1], ["2026-04-01|b", 1]]);

  it("the same list twice gives zero difference, and billed is what runs-service charged", () => {
    const r = compare({ rows, price1, price2: price1, realCost, interval: "month" });
    expect(r.totals.differenceUsdCents).toBe(0);
    expect(r.totals.amount1UsdCents).toBe(108);
    expect(r.totals.billedUsdCents).toBe(108);
    expect(r.totals.billedPlatformKeyUsdCents).toBe(100);
    // customer-key units of a name not declared ours cost us nothing
    expect(r.totals.realCostUsdCents).toBe(20);
    expect(r.totals.margin1UsdCents).toBe(88);
    expect(r.buckets.map((b) => b.period)).toEqual(["2026-03-01", "2026-04-01"]);
    expect(r.buckets[1].cumulative.amount1UsdCents).toBe(108);
  });

  it("prices a second list, states the difference, and flags names a list does not price", () => {
    const r = compare({ rows, price1, price2: new Map([["a", 10]]), realCost, interval: "week" });
    expect(r.totals).toMatchObject({ amount2UsdCents: 200, differenceUsdCents: 92, margin2UsdCents: 180, margin2Pct: 90 });
    expect(r.unpricedCostNames2).toEqual(["b"]);
    expect(r.buckets.map((b) => b.period)).toEqual(["2026-03-02", "2026-03-09", "2026-03-30"]);
    expect(r.costItems[0]).toMatchObject({ costName: "a", quantity: 20, price1PerUnitUsdCents: 5, price2PerUnitUsdCents: 10, differenceUsdCents: 100 });
  });

  it("ranks groups by difference, largest increase first", () => {
    const groups = compareByGroup({ rows, price1, price2: new Map([["a", 10], ["b", 2]]), realCost }, (r) => r.orgId ?? "");
    expect(groups.map((g) => g.key)).toEqual(["o1", "o2"]);
  });

  it("weeks start on Monday", () => {
    expect(periodOf("2026-10-04", "week")).toBe("2026-09-28");
    expect(periodOf("2026-09-28", "week")).toBe("2026-09-28");
  });
});
