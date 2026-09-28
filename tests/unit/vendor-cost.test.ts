import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  SEED_PROVIDERS_COSTS,
  COST_DEFAULT_MULTIPLIER,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";
import {
  MARKUP_ERAS,
  CHINA_VAT_PRICED_FROM,
  divideExactly,
  invertMarkup,
  markupsInForceAt,
  resolveVendorCost,
  seedVendorCost,
  seedVendorRatesByKey,
  type CatalogRowForVendorCost,
} from "../../src/lib/vendor-cost.js";

const rates = seedVendorRatesByKey(SEED_PROVIDERS_COSTS);

function seedVendor(name: string): string | null {
  const entries = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
  expect(entries.length, name).toBeGreaterThan(0);
  return seedVendorCost(entries[entries.length - 1]);
}

function row(partial: Partial<CatalogRowForVendorCost> & { name: string; costPerUnitInUsdCents: string | null }): CatalogRowForVendorCost {
  const seed = SEED_PROVIDERS_COSTS.find((c) => c.name === partial.name);
  return {
    provider: seed?.provider ?? "test",
    planTier: seed?.planTier ?? "pay-as-you-go",
    billingCycle: seed?.billingCycle ?? "monthly",
    pricingBasis: "marked-up",
    createdAt: new Date("2026-09-20T00:00:00Z"),
    ...partial,
  };
}

describe("vendor cost of the current seed", () => {
  it("equals the vendor's published list price on well-known token lines", () => {
    // $/MTok ÷ 10,000 = cents per token (the catalog's unit convention).
    expect(seedVendor("anthropic-haiku-4.5-tokens-input")).toBe("0.0001000000"); // $1/MTok
    expect(seedVendor("google-flash-3-tokens-input")).toBe("0.0000500000"); // $0.50/MTok
  });

  it("includes DeepSeek's non-recoverable 6% VAT on top of the list price", () => {
    // V4.1 Flash peak cache-miss input lists at $0.30/MTok → 0.00003 ¢/token; paid 1.06× that.
    expect(seedVendor("deepseek-v4.1-flash-peak-tokens-input")).toBe("0.0000318000");
  });

  it("is the billed price itself on a pass-through line", () => {
    expect(seedVendor("google-ads-spend")).toBe("1.0000000000");
  });

  it("is null on a delisted version, never zero", () => {
    expect(seedVendor("instantly-contact-uploaded")).toBeNull();
  });

  it("reproduces every marked-up seed price exactly under the current markup", () => {
    for (const entry of SEED_PROVIDERS_COSTS) {
      const vendor = seedVendorCost(entry);
      if (entry.costPerUnitInUsdCents === null || entry.pricingBasis === "pass-through") continue;
      expect(applyCostRiskMultiplier(vendor!), entry.name).toBe(entry.costPerUnitInUsdCents);
    }
  });

  it("relies on no per-cost markup override in seed.ts (the vendor rate is billed ÷ the default markup)", () => {
    const src = readFileSync("src/db/seed.ts", "utf8");
    const overrides: string[] = [];
    let i = src.indexOf("applyCostRiskMultiplier(");
    while (i !== -1) {
      const before = src.slice(Math.max(0, i - 16), i);
      let depth = 0;
      let j = i + "applyCostRiskMultiplier".length;
      let topLevelComma = false;
      for (; j < src.length; j++) {
        const ch = src[j];
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) break; }
        else if (ch === "," && depth === 1) topLevelComma = true;
      }
      if (topLevelComma && !before.includes("function ")) overrides.push(src.slice(i, j + 1));
      i = src.indexOf("applyCostRiskMultiplier(", j);
    }
    expect(overrides).toEqual([]);
  });
});

describe("markup eras", () => {
  it("end on the current store markup — changing the markup means appending an era", () => {
    expect(MARKUP_ERAS[MARKUP_ERAS.length - 1].multipliers).toEqual([COST_DEFAULT_MULTIPLIER]);
  });

  it("are in chronological order", () => {
    for (let k = 1; k < MARKUP_ERAS.length; k++) {
      expect(MARKUP_ERAS[k].from.getTime()).toBeGreaterThan(MARKUP_ERAS[k - 1].from.getTime());
    }
  });

  it("date the 6x era between the v0.51.0 and v0.58.0 promotes", () => {
    expect(markupsInForceAt(new Date("2026-09-01T00:00:00Z"))).toEqual([6]);
    expect(markupsInForceAt(new Date("2026-09-16T00:00:00Z"))).toEqual([5]);
    expect(markupsInForceAt(new Date("2026-07-20T00:00:00Z"))).toEqual([4]);
  });

  it("dates the 2.5x trial of 2026-09-28 and the return to 5x after it", () => {
    expect(markupsInForceAt(new Date("2026-09-28T04:55:36Z"))).toEqual([2.5]);
    expect(markupsInForceAt(new Date("2026-09-29T00:00:00Z"))).toEqual([5]);
    // A trial-era row whose vendor rate 2.5 does not divide still resolves exactly.
    const res = resolveVendorCost(
      row({ name: "firecrawl-scrape-credit", costPerUnitInUsdCents: "1.5833333333", createdAt: new Date("2026-09-28T04:55:36Z") }),
      rates,
    );
    expect(res).toMatchObject({ vendorCostPerUnitInUsdCents: "0.6333333333", markupMultiplier: "2.5000" });
  });
});

describe("invertMarkup", () => {
  it("recovers a vendor rate a fractional markup rounded (2.5x on an odd last digit)", () => {
    // 0.6333333333 x 2.5 = 1.58333333325 -> seed rounds half-up to 1.5833333333, which 2.5 does not divide.
    expect(divideExactly("1.5833333333", 2.5)).toBeNull();
    expect(invertMarkup("1.5833333333", 2.5)).toBe("0.6333333333");
    expect(applyCostRiskMultiplier("0.6333333333", 2.5)).toBe("1.5833333333");
  });

  it("agrees with exact division on an integer markup and refuses a billed value no vendor rate produces", () => {
    expect(invertMarkup("0.0006000000", 6)).toBe("0.0001000000");
    expect(invertMarkup("0.0000000001", 6)).toBeNull();
  });

  it("reproduces every current marked-up seed row (the boot would throw otherwise)", () => {
    for (const entry of SEED_PROVIDERS_COSTS) {
      if (entry.pricingBasis !== "marked-up" || entry.costPerUnitInUsdCents === null) continue;
      const vendor = invertMarkup(entry.costPerUnitInUsdCents, COST_DEFAULT_MULTIPLIER);
      expect(vendor, entry.name).not.toBeNull();
      expect(applyCostRiskMultiplier(vendor!, COST_DEFAULT_MULTIPLIER), entry.name).toBe(entry.costPerUnitInUsdCents);
    }
  });
});

describe("divideExactly", () => {
  it("returns the quotient only when it is exact at 10 decimals", () => {
    expect(divideExactly("0.0006000000", 6)).toBe("0.0001000000");
    expect(divideExactly("0.0000000001", 6)).toBeNull();
    expect(divideExactly("1.2000000000", 1.2)).toBe("1.0000000000");
  });
});

describe("resolveVendorCost on historical price versions", () => {
  const HAIKU = "anthropic-haiku-4.5-tokens-input"; // vendor 0.0001

  it("states a 6x-era row at the vendor rate, with its real 6x markup", () => {
    const r = resolveVendorCost(
      row({ name: HAIKU, costPerUnitInUsdCents: "0.0006000000", createdAt: new Date("2026-08-30T09:50:00Z") }),
      rates,
    );
    expect(r).toEqual({
      vendorCostPerUnitInUsdCents: "0.0001000000",
      markupMultiplier: "6.0000",
      derivation: "seed-vendor-rate",
      unknownReason: null,
    });
  });

  it("states a 4x-era row with 4x, not today's constant", () => {
    const r = resolveVendorCost(
      row({ name: HAIKU, costPerUnitInUsdCents: "0.0004000000", createdAt: new Date("2026-07-20T00:00:00Z") }),
      rates,
    );
    expect(r.vendorCostPerUnitInUsdCents).toBe("0.0001000000");
    expect(r.markupMultiplier).toBe("4.0000");
  });

  it("refuses a billed price that only a markup NOT in force at write time would explain", () => {
    // 0.0006 is exactly 6x the vendor rate, but a row written in the 5x era cannot be 6x.
    const r = resolveVendorCost(
      row({ name: HAIKU, costPerUnitInUsdCents: "0.0006000000", createdAt: new Date("2026-09-20T00:00:00Z") }),
      rates,
    );
    expect(r).toEqual({
      vendorCostPerUnitInUsdCents: null,
      markupMultiplier: null,
      derivation: "unknown",
      unknownReason: "no-vendor-rate-on-record",
    });
  });

  it("never falls back to billed ÷ multiplier when no vendor rate on record reproduces it (a 10x mis-seeded row no statement covers)", () => {
    // Against the CURRENT seed's rates only: the mis-scaled 2026-09-09 literal lives in
    // HISTORICAL_SEED_VENDOR_RATES, which this test deliberately does not load.
    const r = resolveVendorCost(
      row({ name: "anthropic-fable-5.1-tokens-input", costPerUnitInUsdCents: "0.0006000000", createdAt: new Date("2026-09-10T11:10:23Z") }),
      rates,
    );
    expect(r.vendorCostPerUnitInUsdCents).toBeNull();
    expect(r.unknownReason).toBe("no-vendor-rate-on-record");
  });

  it("states a DeepSeek row billed before VAT was priced at the VAT-inclusive cost we paid", () => {
    // V4 Flash's pre-schedule uniform input rate, billed 4x on the VAT-exclusive list price.
    const name = "deepseek-v4-flash-peak-tokens-input";
    const current = SEED_PROVIDERS_COSTS.filter((c) => c.name === name)[0];
    const vendor = seedVendorCost(current)!; // list × 1.06
    const list = divideExactly(vendor, 1.06)!;
    const billed = applyCostRiskMultiplier(list, 4);
    const r = resolveVendorCost(
      row({ name, costPerUnitInUsdCents: billed, createdAt: new Date(CHINA_VAT_PRICED_FROM.getTime() - 86_400_000 * 5) }),
      rates,
    );
    expect(r.vendorCostPerUnitInUsdCents).toBe(vendor);
    expect(r.derivation).toBe("seed-vendor-rate-pre-vat");
  });

  it("does not apply the pre-VAT path to a DeepSeek row written after VAT was priced", () => {
    const name = "deepseek-v4-flash-peak-tokens-input";
    const vendor = seedVendorCost(SEED_PROVIDERS_COSTS.filter((c) => c.name === name)[0])!;
    const billed = applyCostRiskMultiplier(divideExactly(vendor, 1.06)!, 5);
    const r = resolveVendorCost(row({ name, costPerUnitInUsdCents: billed, createdAt: new Date("2026-09-20T00:00:00Z") }), rates);
    expect(r.vendorCostPerUnitInUsdCents).toBeNull();
  });

  it("states a pass-through row at its billed price, markup 1", () => {
    const r = resolveVendorCost(
      row({ name: "google-ads-spend", costPerUnitInUsdCents: "1.0000000000", pricingBasis: "pass-through" }),
      rates,
    );
    expect(r).toMatchObject({ vendorCostPerUnitInUsdCents: "1.0000000000", markupMultiplier: "1.0000", derivation: "pass-through" });
  });

  it("says no-billable-price on a delisted version", () => {
    const r = resolveVendorCost(row({ name: "instantly-contact-uploaded", costPerUnitInUsdCents: null }), rates);
    expect(r.unknownReason).toBe("no-billable-price");
  });

  it("refuses to pick when two vendor rates on record reproduce the same billed price", () => {
    // A row written in the overwrite-in-place era admits 1x and 2x: billed 5.0 is 5.0 × 1 AND
    // 2.5 × 2, and both 5.0 and 2.5 are on record, so there is no single honest answer.
    const ambiguous = new Map([["x|pay-as-you-go|monthly", new Set(["5.0000000000", "2.5000000000"])]]);
    const r = resolveVendorCost(
      { name: "x", provider: "t", planTier: "pay-as-you-go", billingCycle: "monthly", costPerUnitInUsdCents: "5.0000000000", pricingBasis: "marked-up", createdAt: new Date("2026-04-01T00:00:00Z") },
      ambiguous,
    );
    expect(r.unknownReason).toBe("ambiguous-vendor-rate");
  });
});
