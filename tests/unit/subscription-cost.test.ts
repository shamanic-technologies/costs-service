import { describe, it, expect } from "vitest";
import { declaredVat } from "../helpers/ledger-vat.js";
import { costPerCredit, consumptionPerDay, subscriptionMonthly, subscriptionSeries, toMicros } from "../../src/lib/subscription-cost.js";
import { spendPerDayAndVendor } from "../../src/lib/email-send-price.js";
import { SUBSCRIPTIONS, SUBSCRIPTIONS_SINCE, allSubscriptionCostNames, allSubscriptionLedgerVendors, type Subscription } from "../../src/lib/subscriptions.js";
import { SEED_PROVIDERS_COSTS } from "../../src/db/seed.js";

const sub = (key: string) => SUBSCRIPTIONS.find((s) => s.key === key)!;
const day = (d: string, costName: string, quantity: string, costSource: "platform" | "org" = "platform") => ({
  day: d,
  costName,
  costSource,
  quantity,
  refundedQuantity: "0.000000",
});

describe("subscription cost per credit — owner declarations (2026-10-01)", () => {
  it("declares exactly the owner's nine subscriptions, from 2026-01-01", () => {
    expect(SUBSCRIPTIONS.map((s) => s.key)).toEqual(["apollo", "scrape-do", "firecrawl", "apify", "postmark", "serper", "featured", "hunter", "explee"]);
    expect(SUBSCRIPTIONS_SINCE).toBe("2026-01-01");
  });

  it("reads the ledger vendors seen in prod, and Explee has none (unknown, never $0)", () => {
    expect(allSubscriptionLedgerVendors()).toEqual([
      "apollo io",
      "scrape do scrape",
      "firecrawl dev",
      "apify inv",
      "apify subscription",
      "postmarkapp com",
      "paddle net serper",
      "featured terkel",
      "hunter io starter",
    ]);
    expect(sub("explee").ledgerVendors).toEqual([]);
  });

  it("counts the owner's credits: Apollo without search, Firecrawl without extract tokens, Apify results without actor starts", () => {
    expect(sub("apollo").creditCostNames).toEqual(["apollo-credit", "apollo-enrichment-credit", "apollo-person-match-credit"]);
    expect(sub("apollo").excludedCostNames.map((e) => e.costName)).toEqual(["apollo-search-credit"]);
    expect(sub("firecrawl").creditCostNames).toEqual(["firecrawl-scrape-credit", "firecrawl-map-credit"]);
    expect(sub("firecrawl").excludedCostNames.map((e) => e.costName)).toEqual(["firecrawl-extract-token"]);
    expect(sub("apify").creditDefinition).toMatch(/MIXED/);
    expect(sub("apify").excludedCostNames.map((e) => e.costName)).toEqual(["apify-pipelinelabs-actor-start"]);
  });

  it("covers every catalogue cost name of a subscription provider, as a credit or an exclusion", () => {
    const declared = new Set(allSubscriptionCostNames());
    const providers = new Set(SUBSCRIPTIONS.map((s) => s.provider));
    const seeded = [...new Set(SEED_PROVIDERS_COSTS.filter((c) => providers.has(c.provider)).map((c) => c.name))];
    // featured-api-opportunity-fetch is not in the seed; every seeded name must be declared.
    for (const name of seeded) expect(declared, name).toContain(name);
  });

  it("counts customer-key units only where key-service proved they went through our key (Serper, Apify)", () => {
    expect(SUBSCRIPTIONS.filter((s) => s.orgKeyRows.count).map((s) => s.key)).toEqual(["apify", "serper"]);
  });
});

describe("subscription cost per credit — formula", () => {
  it("parses scale-6 quantities exactly", () => {
    expect(toMicros("142771.000000")).toBe(142_771_000_000);
    expect(toMicros("19.5")).toBe(19_500_000);
    expect(() => toMicros("1e3")).toThrow();
  });

  it("reproduces the 2026-10-01 Apollo figure: ~$1,761 over 60,879 credits is ~2.9 US cents", () => {
    expect(costPerCredit(176_100, 60_879 * 1_000_000)).toBeCloseTo(2.8926, 3);
  });

  it("is null, never zero or infinite, over zero credits, a negative net, or an unknown spend", () => {
    expect(costPerCredit(4_900, 0)).toBeNull();
    expect(costPerCredit(-100, 1_000_000)).toBeNull();
    expect(costPerCredit(null, 1_000_000)).toBeNull();
  });

  it("builds a dense series from 2026-01-01 on NET paid, gross beside, and leaves out customer-key units", () => {
    const spend = spendPerDayAndVendor([
      { id: "postmarkapp com:2026-01-19", vendor: "postmarkapp com", bookedOn: "2026-01-19", direction: "payment" as const, usdAmount: 15, vat: declaredVat(15) },
      { id: "postmarkapp com:2026-02-19", vendor: "postmarkapp com", bookedOn: "2026-02-19", direction: "payment" as const, usdAmount: 15, vat: declaredVat(15) },
      { id: "postmarkapp com:2026-02-20", vendor: "postmarkapp com", bookedOn: "2026-02-20", direction: "refund" as const, usdAmount: 10, vat: declaredVat(10) },
      { id: "apollo io:2026-02-01", vendor: "apollo io", bookedOn: "2026-02-01", direction: "payment" as const, usdAmount: 99, vat: declaredVat(99) },
    ]);
    const units = consumptionPerDay([
      day("2026-01-20", "postmark-email-send", "500"),
      day("2026-02-21", "postmark-email-send", "1500"),
      day("2026-02-21", "postmark-email-send", "7000", "org"),
    ]);
    const series = subscriptionSeries(sub("postmark"), spend, units, "2026-01-01", "2026-03-01");
    expect(series[0].day).toBe("2026-01-01");
    expect(series).toHaveLength(31 + 28 + 1);
    expect(series.find((p) => p.day === "2026-01-19")!.costPerCreditUsdCents).toBeNull();
    expect(series.find((p) => p.day === "2026-01-20")!.costPerCreditUsdCents).toBe(3); // 1500c / 500
    const last = series[series.length - 1];
    expect(last).toMatchObject({ cumulativePaidUsdCents: 3000, cumulativeNetUsdCents: 2000, cumulativeCreditsMicros: 2_000_000_000 });
    expect(last.costPerCreditUsdCents).toBe(1); // 2000c / 2000, net
    expect(last.grossCostPerCreditUsdCents).toBe(1.5);

    const feb = subscriptionMonthly(series).find((m) => m.month === "2026-02")!;
    expect(feb).toMatchObject({ paidUsdCents: 1500, refundedUsdCents: 1000, netUsdCents: 500, creditsMicros: 1_500_000_000 });
    expect(feb.monthCostPerCreditUsdCents).toBeCloseTo(0.3333, 4);
    expect(feb.costPerCreditUsdCents).toBe(1);
  });

  it("counts customer-key units for a subscription whose org rows went through our key", () => {
    const serper: Subscription = sub("serper");
    const spend = spendPerDayAndVendor([{ id: "paddle net serper:2026-03-27", vendor: "paddle net serper", bookedOn: "2026-03-27", direction: "payment" as const, usdAmount: 50, vat: declaredVat(50) }]);
    const units = consumptionPerDay([day("2026-03-28", "serper-dev-query", "50000", "org")]);
    const last = subscriptionSeries(serper, spend, units, "2026-01-01", "2026-04-01").pop()!;
    expect(last.costPerCreditUsdCents).toBe(0.1);
  });

  it("serves money as null (unknown) for a subscription with no ledger line, credits still counted", () => {
    const units = consumptionPerDay([day("2026-09-26", "explee-credit", "9")]);
    const last = subscriptionSeries(sub("explee"), [], units, "2026-01-01", "2026-10-01").pop()!;
    expect(last).toMatchObject({ paidUsdCents: null, cumulativeNetUsdCents: null, costPerCreditUsdCents: null, cumulativeCreditsMicros: 9_000_000 });
  });

  it("rejects a consumption key reported twice", () => {
    expect(() => consumptionPerDay([day("2026-02-01", "apollo-credit", "1"), day("2026-02-01", "apollo-credit", "2")])).toThrow(/twice/);
  });
});
