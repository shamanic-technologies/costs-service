import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { SEED_PROVIDERS_COSTS } from "../../src/db/seed.js";
import {
  RECONSTRUCTED_PRICE_VERSIONS,
  VENDOR_COST_STATEMENTS,
  findVendorCostStatement,
} from "../../src/lib/vendor-cost-statements.js";
import {
  normalizeCents,
  resolveVendorCost,
  seedVendorCost,
  seedVendorRatesByKey,
  type CatalogRowForVendorCost,
} from "../../src/lib/vendor-cost.js";

const rates = seedVendorRatesByKey(SEED_PROVIDERS_COSTS);

function row(p: Partial<CatalogRowForVendorCost> & { name: string; costPerUnitInUsdCents: string | null; createdAt: Date }): CatalogRowForVendorCost {
  return { provider: "instantly", planTier: "hypergrowth", billingCycle: "monthly", pricingBasis: "marked-up", ...p };
}

// --- The paid allocation, re-derived from its inputs --------------------------------------------
// tests/fixtures/paid-allocation-inputs.json holds the bank charges (USD; EUR charges converted at
// that month's rate from our own USD card charges) and the units production recorded per period,
// exported 2026-09-28. Exact rational arithmetic; the only rounding is the final half-up to 10dp.

type Frac = { n: bigint; d: bigint };
const frac = (n: bigint, d = 1n): Frac => ({ n, d });
const add = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
const div = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n);
const dec = (s: string): Frac => {
  const [i, f = ""] = s.split(".");
  return frac(BigInt(i + f), 10n ** BigInt(f.length));
};
function round10(x: Frac): string {
  const scale = 10n ** 10n;
  const q = (x.n * scale * 2n + x.d) / (2n * x.d); // half-up, x >= 0
  return `${q / scale}.${(q % scale).toString().padStart(10, "0")}`;
}

const inputs = JSON.parse(readFileSync("tests/fixtures/paid-allocation-inputs.json", "utf8")) as {
  charges: { pool: "instantly" | "mailbox" | "featured"; settled: string; usd: string }[];
  units: { periodStart: string; periodEnd: string; name: string; billed: string; units: string }[];
};

const DAY = 86_400_000;
const day = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const LAST_SEND_DAY = day("2026-08-23"); // the Instantly lines were delisted that day
const LAST_PITCH_DAY = day("2026-08-05"); // last Featured pitch billed

/** A charge pays for the 30 days starting the day it settles; the share inside [a, b] counts. */
function spend(pool: string, a: number, b: number): Frac {
  let s = frac(0n);
  for (const c of inputs.charges.filter((x) => x.pool === pool)) {
    const from = day(c.settled);
    const lo = Math.max(a, from);
    const hi = Math.min(b, from + 29);
    if (hi >= lo) s = add(s, mul(dec(c.usd), frac(BigInt(hi - lo + 1), 30n)));
  }
  return s;
}

function derivePaidAllocation(): Map<string, string> {
  const periods = [...new Set(inputs.units.map((u) => `${u.periodStart}|${u.periodEnd}`))];
  const totals = new Map<string, { vendor: Frac; units: bigint }>();
  for (const p of periods) {
    const [ps, pe] = p.split("|");
    const a = day(ps);
    const b = day(pe);
    const inPeriod = inputs.units.filter((u) => u.periodStart === ps);
    const u = (name: string) => inPeriod.filter((x) => x.name === name).reduce((s, x) => s + BigInt(x.units), 0n);
    const si = spend("instantly", a, Math.min(b, LAST_SEND_DAY));
    const sm = spend("mailbox", a, Math.min(b, LAST_SEND_DAY));
    const sf = spend("featured", a, Math.min(b, LAST_PITCH_DAY));
    const rate: Record<string, Frac> = { "instantly-domain-email-sent": frac(0n) };
    if (u("instantly-email-send")) rate["instantly-email-send"] = div(add(si, sm), frac(u("instantly-email-send")));
    if (u("instantly-account-email-sent")) rate["instantly-account-email-sent"] = div(sm, frac(u("instantly-account-email-sent")));
    if (u("instantly-contact-uploaded")) rate["instantly-contact-uploaded"] = div(si, frac(u("instantly-contact-uploaded")));
    if (u("featured-api-pitch-submit")) rate["featured-api-pitch-submit"] = div(sf, frac(u("featured-api-pitch-submit")));
    for (const x of inPeriod) {
      const key = `${x.name}|${x.billed}`;
      const t = totals.get(key) ?? { vendor: frac(0n), units: 0n };
      totals.set(key, { vendor: add(t.vendor, mul(rate[x.name], frac(BigInt(x.units)))), units: t.units + BigInt(x.units) });
    }
  }
  const out = new Map<string, string>();
  for (const [key, t] of totals) out.set(key, round10(mul(div(t.vendor, frac(t.units)), frac(100n)))); // USD -> cents
  return out;
}

describe("paid-allocation statements (cold-email infrastructure, Featured)", () => {
  const derived = derivePaidAllocation();

  it("re-derive byte-equal from the committed charges and units", () => {
    const stated = [
      ...VENDOR_COST_STATEMENTS.filter((s) => s.derivation === "paid-allocation"),
      ...RECONSTRUCTED_PRICE_VERSIONS.filter((r) => r.derivation === "paid-allocation"),
    ];
    let checked = 0;
    for (const s of stated) {
      const key = `${s.name}|${normalizeCents(s.billedPricePerUnitInUsdCents)}`;
      if (!derived.has(key)) continue; // a version no unit was ever billed at (e.g. the growth contact rows)
      expect(normalizeCents(s.vendorCostPerUnitInUsdCents!), key).toBe(derived.get(key));
      checked++;
    }
    expect(checked).toBe(derived.size);
  });

  it("covers every (name, billed price) production billed units at", () => {
    const stated = new Set([
      ...VENDOR_COST_STATEMENTS.map((s) => `${s.name}|${normalizeCents(s.billedPricePerUnitInUsdCents)}`),
      ...RECONSTRUCTED_PRICE_VERSIONS.map((r) => `${r.name}|${normalizeCents(r.billedPricePerUnitInUsdCents)}`),
    ]);
    for (const key of derived.keys()) expect(stated.has(key), key).toBe(true);
  });

  it("an unbilled plan tier of the same version carries the same plan-agnostic figure", () => {
    const at = (billed: string) => VENDOR_COST_STATEMENTS.find((s) => s.name === "instantly-contact-uploaded" && s.billedPricePerUnitInUsdCents === billed)!;
    expect(at("9.4000000000").vendorCostPerUnitInUsdCents).toBe(at("0.7760000000").vendorCostPerUnitInUsdCents);
    expect(at("18.8000000000").vendorCostPerUnitInUsdCents).toBe(at("1.5520000000").vendorCostPerUnitInUsdCents);
  });
});

describe("resolveVendorCost with statements", () => {
  it("states the Instantly per-email line from what we paid (was unknown: the seed rate is delisted)", () => {
    const r = resolveVendorCost(row({ name: "instantly-account-email-sent", costPerUnitInUsdCents: "6.5481481480", createdAt: new Date("2026-07-09T15:11:05Z") }), rates);
    expect(r).toMatchObject({ derivation: "paid-allocation", vendorCostPerUnitInUsdCents: "2.7788644351", unknownReason: null, markupMultiplier: "2.3564" });
  });

  it("states the per-domain line at 0 with no markup (its charges sit on the account line)", () => {
    const r = resolveVendorCost(row({ name: "instantly-domain-email-sent", costPerUnitInUsdCents: "0.3968000000", createdAt: new Date("2026-04-19T04:41:58Z") }), rates);
    expect(r).toMatchObject({ derivation: "paid-allocation", vendorCostPerUnitInUsdCents: "0.0000000000", markupMultiplier: null });
  });

  it("overrides the seed's modelled Featured rate on the versions pitches were billed at", () => {
    const r = resolveVendorCost(row({ name: "featured-api-pitch-submit", provider: "featured", planTier: "pay-as-you-go", costPerUnitInUsdCents: "0.2000000000", createdAt: new Date("2026-07-09T15:11:05Z") }), rates);
    expect(r).toMatchObject({ derivation: "paid-allocation", vendorCostPerUnitInUsdCents: "23.7789929340" });
  });

  it("leaves a later Featured version on the seed (never captured by a statement's window)", () => {
    const r = resolveVendorCost(row({ name: "featured-api-pitch-submit", provider: "featured", planTier: "pay-as-you-go", costPerUnitInUsdCents: "0.2500000000", createdAt: new Date("2026-09-28T05:05:41Z") }), rates);
    expect(r.derivation).toBe("seed-vendor-rate");
  });

  it("does not capture a same-priced row written outside the statement's window", () => {
    expect(findVendorCostStatement({ name: "instantly-account-email-sent", planTier: "hypergrowth", costPerUnitInUsdCents: "6.5481481480", createdAt: new Date("2026-10-01T00:00:00Z") })).toBeNull();
  });

  it("states Fable 5.1 / GPT-6 Astra mis-seeded rows at the list price the corrected seed carries", () => {
    for (const s of VENDOR_COST_STATEMENTS.filter((x) => x.derivation === "vendor-list-price" && /fable|astra/.test(x.name))) {
      const seed = SEED_PROVIDERS_COSTS.filter((c) => c.name === s.name).map(seedVendorCost);
      expect(seed, s.name).toContain(s.vendorCostPerUnitInUsdCents);
    }
    const r = resolveVendorCost(row({ name: "anthropic-fable-5.1-tokens-input", provider: "anthropic", planTier: "pay-as-you-go", costPerUnitInUsdCents: "0.0006000000", createdAt: new Date("2026-09-09T11:10:23Z") }), rates);
    expect(r).toMatchObject({ derivation: "vendor-list-price", vendorCostPerUnitInUsdCents: "0.0010000000" });
  });

  it("gives the retired Vercel-gateway rows a specific unknown reason", () => {
    const r = resolveVendorCost(row({ name: "deepseek-v4-flash-tokens-input", provider: "vercel", planTier: "pay-as-you-go", costPerUnitInUsdCents: "0.0001760000", createdAt: new Date("2026-08-14T10:20:41Z") }), rates);
    expect(r).toMatchObject({ derivation: "unknown", vendorCostPerUnitInUsdCents: null, unknownReason: "vendor-rate-not-retained" });
  });

  it("still reads a delisted (null-priced) version as no-billable-price", () => {
    const r = resolveVendorCost(row({ name: "instantly-account-email-sent", costPerUnitInUsdCents: null, createdAt: new Date("2026-08-23T17:16:35Z") }), rates);
    expect(r.unknownReason).toBe("no-billable-price");
  });

  it("every statement has a note, and no two statements can cover the same row", () => {
    for (const s of VENDOR_COST_STATEMENTS) expect(s.note.length, s.name).toBeGreaterThan(20);
    for (let i = 0; i < VENDOR_COST_STATEMENTS.length; i++) {
      for (let j = i + 1; j < VENDOR_COST_STATEMENTS.length; j++) {
        const a = VENDOR_COST_STATEMENTS[i];
        const b = VENDOR_COST_STATEMENTS[j];
        const samePlans = !a.planTiers || !b.planTiers || a.planTiers.some((t) => b.planTiers!.includes(t));
        const overlap = a.createdFrom < b.createdTo && b.createdFrom < a.createdTo;
        const same = a.name === b.name && normalizeCents(a.billedPricePerUnitInUsdCents) === normalizeCents(b.billedPricePerUnitInUsdCents);
        expect(same && samePlans && overlap, `${a.name} ${a.billedPricePerUnitInUsdCents}`).toBe(false);
      }
    }
  });
});

describe("reconstructed pre-v0.25.0 versions", () => {
  it("were all served before the 2026-05-03 risk markup, so the 1x seed literal IS the vendor rate", () => {
    for (const r of RECONSTRUCTED_PRICE_VERSIONS) {
      expect(r.servedFrom < new Date("2026-05-03T00:00:00Z"), r.name).toBe(true);
      if (r.derivation === "seed-vendor-rate") expect(r.vendorCostPerUnitInUsdCents, r.name).toBe(r.billedPricePerUnitInUsdCents);
    }
  });

  it("carry the published list price on well-known token lines ($/MTok / 10,000)", () => {
    const v = (name: string) => RECONSTRUCTED_PRICE_VERSIONS.find((r) => r.name === name)!.vendorCostPerUnitInUsdCents;
    expect(v("anthropic-sonnet-4.6-tokens-input")).toBe("0.0003000000"); // $3/MTok
    expect(v("anthropic-haiku-4.5-tokens-input")).toBe("0.0001000000"); // $1/MTok
    expect(v("google-pro-3.1-tokens-input")).toBe("0.0002000000"); // $2/MTok
  });

  it("are unique per (name, plan, billed price)", () => {
    const keys = RECONSTRUCTED_PRICE_VERSIONS.map((r) => `${r.name}|${r.planTier}|${r.billedPricePerUnitInUsdCents}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
