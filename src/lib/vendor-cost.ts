/**
 * What one unit of a cost line REALLY cost us from the vendor — the figure BEFORE our markup.
 *
 * The catalog stores the price we CHARGE: vendor rate × the store markup for a marked-up line,
 * the vendor rate itself for a pass-through line, nothing for a delisted one. The markup has
 * moved several times (1× → 2× → 4× → 5× → 6× → 5×), so nobody downstream can recover a past
 * row's vendor cost by dividing by today's constant. This module states it per price VERSION,
 * from evidence, and says "unknown" (with a reason) whenever the evidence is missing — it never
 * falls back to the billed price, and never divides by a multiplier it cannot show was in force.
 *
 * STAFF-ONLY. The vendor cost reveals our margin: it is served on `/internal/vendor-costs`
 * behind the service api key and nowhere else (never on `/v1/platform-prices`, which the public
 * pricing page reads, nor on the identity-header-only `/v1/providers-costs` reads).
 */
import {
  COST_DEFAULT_MULTIPLIER,
  CHINA_VAT_MULTIPLIER,
  withChinaVat,
  type SeedProviderCost,
} from "../db/seed.js";

const SCALE = 10;
const FACTOR_SCALE = 4; // same factor precision as the seed's scaleFixedDecimalCost

/** A fixed 10-decimal cents string → integer (× 10^10). Throws on anything else. */
function toScaled(value: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,10}))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid cost value: '${value}'`);
  return BigInt(`${m[1]}${(m[2] ?? "").padEnd(SCALE, "0")}`);
}

function fromScaled(scaled: bigint): string {
  const divisor = 10n ** BigInt(SCALE);
  return `${scaled / divisor}.${(scaled % divisor).toString().padStart(SCALE, "0")}`;
}

/** Canonical 10-decimal form, so "5.0" and "5.0000000000" compare equal. */
export function normalizeCents(value: string): string {
  return fromScaled(toScaled(value));
}

/**
 * `value ÷ factor` if — and only if — the division is EXACT at 10 decimals. `null` otherwise.
 * An inexact quotient means `value` was not produced by multiplying a 10-decimal figure by
 * `factor`, so it is evidence AGAINST that factor, never a figure to round and use.
 */
export function divideExactly(value: string, factor: number): string | null {
  const factorScaled = BigInt(Math.round(factor * 10 ** FACTOR_SCALE));
  if (factorScaled <= 0n) throw new Error(`Invalid factor: ${factor}`);
  const numerator = toScaled(value) * 10n ** BigInt(FACTOR_SCALE);
  if (numerator % factorScaled !== 0n) return null;
  return fromScaled(numerator / factorScaled);
}

/** billed ÷ vendor, rounded to 4 decimals (only ever called on an exact pair). */
function markupOf(billed: string, vendor: string): string {
  const v = toScaled(vendor);
  if (v === 0n) return "1.0000";
  const scaled = (toScaled(billed) * 10n ** BigInt(FACTOR_SCALE) + v / 2n) / v;
  const d = 10n ** BigInt(FACTOR_SCALE);
  return `${scaled / d}.${(scaled % d).toString().padStart(FACTOR_SCALE, "0")}`;
}

/**
 * The store markup(s) that could have produced a marked-up row, by the instant the row was
 * WRITTEN (`created_at`). Each boundary is the production merge of the promote that changed the
 * markup; a row is written by the boot that follows a deploy, so it always lands on the new side.
 *
 * Two eras admit more than one factor, on purpose:
 *  - before 2026-06-07T01:28:53Z the seed OVERWROTE prices in place (`ON CONFLICT DO UPDATE`,
 *    removed by v0.25.0), so a row created then carries whatever its last overwrite wrote: raw
 *    (1×) before the 2026-05-03 risk markup, 2× after it.
 *  - 2026-06-07T08:31Z → 2026-06-29T14:04Z two names (apollo-credit, gemini-3.1-pro) carried a
 *    1.2× per-cost override; the whole 2× era admits 1.2 so those rows can match.
 *
 * The LAST era is open-ended and uses COST_DEFAULT_MULTIPLIER. Changing the markup means
 * appending an era here, dated at that promote's merge — `tests/unit/vendor-cost.test.ts`
 * fails until the last era's factor equals the constant again.
 */
export const MARKUP_ERAS: { from: Date; multipliers: number[]; label: string }[] = [
  { from: new Date("1970-01-01T00:00:00Z"), multipliers: [1, 2], label: "overwrite-in-place (raw, then 2x from 2026-05-03)" },
  { from: new Date("2026-06-07T01:28:53Z"), multipliers: [2, 1.2], label: "2x risk markup (1.2x overrides on two names)" },
  { from: new Date("2026-07-09T15:05:07Z"), multipliers: [4], label: "4x (risk 2 x profit 2)" },
  { from: new Date("2026-08-23T17:13:51Z"), multipliers: [5], label: "5x (risk 2 x profit 2.5)" },
  { from: new Date("2026-08-30T09:41:26Z"), multipliers: [6], label: "6x (risk 2 x profit 3)" },
  { from: new Date("2026-09-15T08:47:36Z"), multipliers: [COST_DEFAULT_MULTIPLIER], label: "current store markup" },
];

export function markupsInForceAt(writtenAt: Date): number[] {
  let found = MARKUP_ERAS[0].multipliers;
  for (const era of MARKUP_ERAS) {
    if (era.from <= writtenAt) found = era.multipliers;
  }
  return found;
}

/**
 * DeepSeek's 6% Chinese VAT was always PAID, but only PRICED into the catalog from this
 * promote (v0.50.0). A DeepSeek row written before it was billed on the VAT-exclusive list
 * price; its vendor cost is still the VAT-inclusive figure, because that is what we paid.
 */
export const CHINA_VAT_PRICED_FROM = new Date("2026-08-25T10:08:52Z");
const CHINA_VAT_PROVIDERS = new Set(["deepseek"]);

/**
 * Vendor cost of one CURRENT seed version, stated at the moment the seed writes it.
 *
 * Every marked-up seed value is `applyCostRiskMultiplier(vendor)` with the default multiplier
 * (`tests/unit/vendor-cost.test.ts` forbids a per-cost override in seed.ts), so the division
 * below is exact by construction; the round trip is asserted anyway, and a value that does not
 * reproduce throws at boot rather than being stated wrong.
 */
export function seedVendorCost(entry: SeedProviderCost): string | null {
  if (entry.costPerUnitInUsdCents === null) return null;
  if (entry.pricingBasis === "pass-through") return normalizeCents(entry.costPerUnitInUsdCents);
  const vendor = divideExactly(entry.costPerUnitInUsdCents, COST_DEFAULT_MULTIPLIER);
  if (vendor === null) {
    throw new Error(
      `Seed cost '${entry.name}' (${entry.costPerUnitInUsdCents}) is not an exact ${COST_DEFAULT_MULTIPLIER}x markup of a 10-decimal vendor rate.`
    );
  }
  return vendor;
}

export type VendorCostDerivation =
  | "pass-through"          // basis pass-through: the billed price IS the vendor rate
  | "seed-vendor-rate"      // billed = a vendor rate the seed states for this name × the markup in force when written
  | "seed-vendor-rate-pre-vat" // same, on a row billed before the vendor's non-recoverable VAT was priced in
  | "unknown";

export type VendorCostUnknownReason =
  | "no-billable-price"        // a delisted version: no price, nothing was charged against it
  | "no-vendor-rate-on-record" // no vendor rate we hold reproduces this billed price under the markup in force
  | "ambiguous-vendor-rate";   // two different vendor rates reproduce it; we refuse to pick

export interface VendorCostResolution {
  vendorCostPerUnitInUsdCents: string | null;
  markupMultiplier: string | null;
  derivation: VendorCostDerivation;
  unknownReason: VendorCostUnknownReason | null;
}

export interface CatalogRowForVendorCost {
  name: string;
  provider: string;
  planTier: string;
  billingCycle: string;
  costPerUnitInUsdCents: string | null;
  pricingBasis: string;
  createdAt: Date;
}

const unknown = (unknownReason: VendorCostUnknownReason): VendorCostResolution => ({
  vendorCostPerUnitInUsdCents: null,
  markupMultiplier: null,
  derivation: "unknown",
  unknownReason,
});

/**
 * Vendor rates the seed states for each (name, plan, cycle) — every version, not only the
 * newest, so a row written under an older in-seed version still finds its rate.
 */
export function seedVendorRatesByKey(seed: SeedProviderCost[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entry of seed) {
    const vendor = seedVendorCost(entry);
    if (vendor === null) continue;
    const key = `${entry.name}|${entry.planTier}|${entry.billingCycle}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(vendor);
  }
  return map;
}

/**
 * Resolve one catalog row's vendor cost from evidence.
 *
 * A marked-up row is stated only when its billed price equals, EXACTLY, a vendor rate the seed
 * records for that very (name, plan, cycle) times a markup that was in force when the row was
 * written. That is a reproduction, not an estimate: if the vendor rate has since changed, or the
 * row was hand-written at some other figure, nothing reproduces and the answer is `unknown`.
 */
export function resolveVendorCost(
  row: CatalogRowForVendorCost,
  vendorRates: Map<string, Set<string>>,
): VendorCostResolution {
  if (row.costPerUnitInUsdCents === null) return unknown("no-billable-price");

  const billed = normalizeCents(row.costPerUnitInUsdCents);

  if (row.pricingBasis === "pass-through") {
    return { vendorCostPerUnitInUsdCents: billed, markupMultiplier: "1.0000", derivation: "pass-through", unknownReason: null };
  }
  if (row.pricingBasis !== "marked-up") {
    throw new Error(`Cost '${row.name}' has an unrecognised pricing_basis '${row.pricingBasis}'.`);
  }

  const rates = vendorRates.get(`${row.name}|${row.planTier}|${row.billingCycle}`);
  if (!rates || rates.size === 0) return unknown("no-vendor-rate-on-record");

  const preVat = CHINA_VAT_PROVIDERS.has(row.provider) && row.createdAt < CHINA_VAT_PRICED_FROM;
  const matches = new Map<string, VendorCostDerivation>();
  for (const m of markupsInForceAt(row.createdAt)) {
    const base = divideExactly(billed, m);
    if (base === null) continue;
    if (rates.has(base)) matches.set(base, "seed-vendor-rate");
    if (preVat) {
      const withVat = withChinaVat(base);
      if (rates.has(withVat)) matches.set(withVat, "seed-vendor-rate-pre-vat");
    }
  }

  if (matches.size === 0) return unknown("no-vendor-rate-on-record");
  if (matches.size > 1) return unknown("ambiguous-vendor-rate");
  const [[vendor, derivation]] = [...matches];
  return { vendorCostPerUnitInUsdCents: vendor, markupMultiplier: markupOf(billed, vendor), derivation, unknownReason: null };
}

// Re-exported so a reader of this module sees which VAT factor the pre-VAT path applies.
export { CHINA_VAT_MULTIPLIER };
