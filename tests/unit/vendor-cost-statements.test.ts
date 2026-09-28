import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { SEED_PROVIDERS_COSTS } from "../../src/db/seed.js";
import {
  HISTORICAL_SEED_VENDOR_RATES,
  RECONSTRUCTED_PRICE_VERSIONS,
  withHistoricalSeedRates,
} from "../../src/lib/vendor-cost-statements.js";
import {
  resolveVendorCost,
  seedVendorRatesByKey,
  type CatalogRowForVendorCost,
} from "../../src/lib/vendor-cost.js";

const rates = withHistoricalSeedRates(seedVendorRatesByKey(SEED_PROVIDERS_COSTS));

function row(p: Partial<CatalogRowForVendorCost> & { name: string; costPerUnitInUsdCents: string | null; createdAt: string }): CatalogRowForVendorCost {
  return { provider: "instantly", planTier: "hypergrowth", billingCycle: "monthly", pricingBasis: "marked-up", ...p, createdAt: new Date(p.createdAt) };
}

// Every production price version that read "unknown" before this change (costs_service, 2026-09-28),
// with the seed's vendor rate of the day it was written: billed / the markup of that day.
const PRODUCTION_UNKNOWNS: [string, string, string, string, string, string][] = [
  // name, plan, cycle, billed, created_at, expected vendor
  ["instantly-account-email-sent", "hypergrowth", "monthly", "3.3334000000", "2026-04-19T04:41:58Z", "1.6667000000"],
  ["instantly-account-email-sent", "hypergrowth", "monthly", "0.1587301588", "2026-06-07T01:34:44Z", "0.0793650794"],
  ["instantly-account-email-sent", "hypergrowth", "monthly", "1.4285714286", "2026-06-26T08:20:25Z", "0.7142857143"],
  ["instantly-account-email-sent", "hypergrowth", "monthly", "3.2740740740", "2026-07-01T06:56:28Z", "1.6370370370"],
  ["instantly-account-email-sent", "hypergrowth", "monthly", "6.5481481480", "2026-07-09T15:11:05Z", "1.6370370370"],
  ["instantly-domain-email-sent", "hypergrowth", "monthly", "0.3968000000", "2026-04-19T04:41:58Z", "0.1984000000"],
  ["instantly-domain-email-sent", "growth", "yearly", "0.0000000000", "2026-06-07T01:34:44Z", "0.0000000000"],
  ["instantly-domain-email-sent", "hypergrowth", "monthly", "0.5158730158", "2026-06-26T08:20:25Z", "0.2579365079"],
  ["instantly-domain-email-sent", "hypergrowth", "monthly", "0.0793650794", "2026-07-01T06:56:28Z", "0.0396825397"],
  ["instantly-domain-email-sent", "growth", "yearly", "0.1587301588", "2026-07-09T15:11:05Z", "0.0396825397"],
  ["instantly-contact-uploaded", "hypergrowth", "monthly", "0.7760000000", "2026-04-19T04:41:58Z", "0.3880000000"],
  ["instantly-contact-uploaded", "growth", "monthly", "9.4000000000", "2026-04-19T04:41:58Z", "4.7000000000"],
  ["instantly-contact-uploaded", "hypergrowth", "monthly", "1.5520000000", "2026-07-09T15:11:05Z", "0.3880000000"],
  ["instantly-contact-uploaded", "growth", "monthly", "18.8000000000", "2026-07-09T15:11:05Z", "4.7000000000"],
  ["featured-api-pitch-submit", "premium", "monthly", "198.0000000000", "2026-05-13T07:43:00Z", "99.0000000000"],
  ["featured-api-pitch-submit", "pay-as-you-go", "monthly", "1398.0000000000", "2026-06-05T02:09:36Z", "699.0000000000"],
  ["featured-api-pitch-submit", "pay-as-you-go", "monthly", "200.0000000000", "2026-06-09T13:30:50Z", "100.0000000000"],
  ["featured-api-opportunity-fetch", "premium", "monthly", "0.0000000000", "2026-05-13T07:43:00Z", "0.0000000000"],
  ["anthropic-fable-5.1-tokens-input", "pay-as-you-go", "monthly", "0.0006000000", "2026-09-09T11:10:23Z", "0.0001000000"],
  ["openai-gpt-6-astra-tokens-cached-input", "pay-as-you-go", "monthly", "0.0000600000", "2026-09-09T11:10:23Z", "0.0000100000"],
  ["deepseek-v4-flash-tokens-input", "pay-as-you-go", "monthly", "0.0001760000", "2026-08-14T10:20:41Z", "0.0000440000"],
  ["deepseek-v4-pro-tokens-output", "pay-as-you-go", "monthly", "0.0013920000", "2026-08-15T10:20:43Z", "0.0003480000"],
];

describe("historical seed vendor rates", () => {
  it.each(PRODUCTION_UNKNOWNS)("%s %s %s billed %s: vendor = billed / the markup of the day", (name, planTier, billingCycle, billed, createdAt, vendor) => {
    const r = resolveVendorCost(row({ name, planTier, billingCycle, costPerUnitInUsdCents: billed, createdAt }), rates);
    expect(r).toMatchObject({ derivation: "seed-vendor-rate", vendorCostPerUnitInUsdCents: vendor, unknownReason: null });
  });

  it("are literals the seed really carried (each appears in a past seed.ts, never invented)", () => {
    // The literals are verified against git history when added; here, at least guard their shape
    // and that none is already served by the current seed (it would be dead weight).
    const current = seedVendorRatesByKey(SEED_PROVIDERS_COSTS);
    for (const r of HISTORICAL_SEED_VENDOR_RATES) {
      expect(r.vendorCostPerUnitInUsdCents, r.name).toMatch(/^\d+\.\d{10}$/);
      expect(current.get(`${r.name}|${r.planTier}|${r.billingCycle}`)?.has(r.vendorCostPerUnitInUsdCents) ?? false, r.name).toBe(false);
    }
  });

  it("add no cost of their own: nothing outside the billed price's own line is folded in", () => {
    const src = readFileSync("src/lib/vendor-cost-statements.ts", "utf8");
    expect(src).not.toMatch(/bank|charge|allocation|prorat/i);
  });

  it("still leave a delisted (null-priced) version as no-billable-price", () => {
    const r = resolveVendorCost(row({ name: "instantly-account-email-sent", costPerUnitInUsdCents: null, createdAt: "2026-08-23T17:16:35Z" }), rates);
    expect(r.unknownReason).toBe("no-billable-price");
  });

  it("never match a billed price no markup of the day explains", () => {
    const r = resolveVendorCost(row({ name: "instantly-account-email-sent", costPerUnitInUsdCents: "6.5481481480", createdAt: "2026-06-10T00:00:00Z" }), rates);
    expect(r.derivation).toBe("unknown"); // 2x era: 3.274 would be needed, not 6.548
  });
});

describe("reconstructed pre-v0.25.0 versions", () => {
  it("were all served before the 2026-05-03 risk markup, so vendor = billed (1x)", () => {
    for (const r of RECONSTRUCTED_PRICE_VERSIONS) {
      expect(r.servedFrom < new Date("2026-05-03T00:00:00Z"), r.name).toBe(true);
      expect(r.vendorCostPerUnitInUsdCents, r.name).toBe(r.billedPricePerUnitInUsdCents);
    }
  });

  it("cover the BYOK serper queries billed at $0.001 before the markup (org cost rows, 2026-03-27 .. 05-03)", () => {
    const v = RECONSTRUCTED_PRICE_VERSIONS.find((r) => r.name === "serper-dev-query" && r.billedPricePerUnitInUsdCents === "0.1000000000");
    expect(v?.vendorCostPerUnitInUsdCents).toBe("0.1000000000");
  });

  it("are unique per (name, plan, billed price)", () => {
    const keys = RECONSTRUCTED_PRICE_VERSIONS.map((r) => `${r.name}|${r.planTier}|${r.billedPricePerUnitInUsdCents}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
