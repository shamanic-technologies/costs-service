/**
 * REAL cost per unit of every catalogue cost item, per day since 2026-01-01, and the PROPOSED
 * price derived from it. DISPLAY ONLY: no billed price reads it. Owner rules and every declared
 * list live in `src/lib/price-lists.ts`; this module only applies them.
 *
 * For a cost name on day D (catalogue read at D's end, `CatalogueHistory`):
 *
 *   1. email infrastructure  (EMAIL_SEND_COST_SHARES)   real = email send price(D) x share
 *   2. pass-through line                                 real = catalogue vendor cost(D)        x1
 *   3. subscription credit   (src/lib/subscriptions.ts)  real = real cost per credit(D)
 *      subscription provider, not a credit             real = catalogue vendor cost(D), flagged
 *   4. declared pay-as-you-go API                        real = catalogue vendor cost(D) (list price)
 *         Owner rule 2026-10-01 (LOCKED): averaging bank money over units is ONLY for what we pay
 *         as a flat fee (subscriptions, email infrastructure). An API is priced at its list cost,
 *         never at a bank/runs ratio: "on ne compte que le coût API, le reste c'est hors client".
 *         What the bank paid beyond the list cost our runs recorded is INTERNAL cost, served per
 *         vendor (`paygRatios`), never loaded on a unit.
 *   5. anything else                                     real = catalogue vendor cost(D), flagged
 *
 * Whenever the specific figure does not exist yet on D (no payment, no usage, no email sent), the
 * item falls back to its catalogue vendor cost with a flag naming why — never 0, never a guess.
 *
 *   proposed(D) = real(D) x 2 (x1 for pass-through); a subscription credit is never proposed below
 *                 its vendor's catalogue list cost per unit (owner rule 2026-10-02): averaged x2 under
 *                 the list cost is floored at it (basis `vendor-list-cost-floor`, the averaged x2 kept
 *                 in `proposedBeforeFloor`); a subscription credit with no real cost per
 *                 credit keeps its catalogue price (flag `current-price-kept`); no real cost at all
 *                 also keeps the catalogue price; a delisted line with no real cost has no price.
 */
import { CatalogueHistory, endOfDay } from "./catalogue-history.js";
import {
  CATALOGUE_VENDOR_COST_PROVIDERS,
  EMAIL_SEND_COST_SHARES,
  INCLUDED_AT_VENDOR,
  LEGACY_COST_NAMES,
  PASS_THROUGH_MULTIPLIER,
  PAY_AS_YOU_GO_VENDORS,
  PROPOSED_MULTIPLIER,
} from "./price-lists.js";
import { SUBSCRIPTIONS } from "./subscriptions.js";

export type RealCostMethod =
  | "email-send-price"
  | "pass-through"
  | "subscription"
  | "api-list-cost"
  | "catalogue-vendor-cost"
  | "included-at-vendor";

export type RealCostFlag =
  | "no-email-sent-yet"
  | "not-a-subscription-credit"
  | "no-real-cost-per-credit"
  | "no-ledger-line"
  | "declared-catalogue-vendor-cost"
  | "no-vendor-cost"
  | "included-in-another-cost"
  | "legacy-name-priced-as-successor";

export type ProposedBasis = "real-cost-x2" | "real-cost-x1" | "vendor-list-cost-floor" | "current-price-kept" | "no-price";

export type RealCostDay = {
  day: string;
  costName: string;
  provider: string | null;
  method: RealCostMethod;
  flag: RealCostFlag | null;
  realCost: number | null;
  /** Always null since pay-as-you-go APIs are priced at list cost (kept for the stored shape). */
  ratio: number | null;
  catalogueVendorCost: number | null;
  cataloguePrice: number | null;
  multiplier: number;
  proposedPrice: number | null;
  proposedBasis: ProposedBasis;
  /** Floored items only: the averaged real cost x2 the floor replaced (owner rule 2026-10-02); null otherwise. */
  proposedBeforeFloor: number | null;
};

export type PaygNumeratorBasis = "ledger-net-paid" | "twilio-usage-metered" | "google-cloud-split-metered";

/** A split vendor's metered spend per day (US cents), counted from `from` (the first day the split covers). */
export type MeteredSpend = { from: string; byDay: Map<string, number> };

export type PaygRatioDay = {
  cumulativeNetPaidUsdCents: number;
  /** The ratio's numerator: metered spend through D (= the ledger net paid unless the vendor splits it). */
  cumulativeMeteredUsdCents: number;
  numeratorBasis: PaygNumeratorBasis;
  cumulativeVendorRecordedUsdCents: number;
  /** Informational: metered / recorded. Prices no unit (owner rule 2026-10-01). */
  ratio: number | null;
  /** Vendor cost our runs recorded at list price, every day since 2026-01-01 (no split window). */
  cumulativeVendorRecordedAllUsdCents: number;
};

const round10 = (x: number) => Math.round(x * 1e10) / 1e10;

/** Platform-key units per (day, cost name), quantities as plain numbers. */
export type PlatformUnits = { day: string; costName: string; quantity: number };

/**
 * Per declared pay-as-you-go provider, dense over `days`: cumulative net paid (ledger, US cents),
 * cumulative metered spend (the numerator: `meteredByProviderDay` for a provider that declares a
 * split source, else the net paid) and cumulative vendor cost recorded (platform units x catalogue
 * vendor cost in force that day).
 */
export function paygRatios(
  days: string[],
  netPaidByProviderDay: Map<string, Map<string, number>>,
  units: PlatformUnits[],
  catalogue: CatalogueHistory,
  now: Date,
  metered: Map<string, MeteredSpend> = new Map(),
): Map<string, Map<string, PaygRatioDay>> {
  const splitBasis = new Map(
    PAY_AS_YOU_GO_VENDORS.filter((v) => v.meteredSpend).map((v) => [v.provider, `${v.meteredSpend!.kind}-metered` as PaygNumeratorBasis]),
  );
  for (const p of splitBasis.keys()) {
    if (!metered.has(p)) throw new Error(`Pay-as-you-go vendor ${p} declares a metered spend source but none was read`);
  }
  const providers = new Set(PAY_AS_YOU_GO_VENDORS.map((v) => v.provider));
  const vendorByProviderDay = new Map<string, Map<string, number>>();
  for (const u of units) {
    const { version } = catalogue.versionAt(u.costName, endOfDay(u.day, now));
    if (!version || !providers.has(version.provider) || version.vendorCost === null) continue;
    const m = vendorByProviderDay.get(version.provider) ?? new Map<string, number>();
    m.set(u.day, (m.get(u.day) ?? 0) + u.quantity * version.vendorCost);
    vendorByProviderDay.set(version.provider, m);
  }
  const out = new Map<string, Map<string, PaygRatioDay>>();
  for (const provider of providers) {
    const basis = splitBasis.get(provider) ?? "ledger-net-paid";
    const split = metered.get(provider);
    const numerator = split ? split.byDay : netPaidByProviderDay.get(provider);
    // A split numerator only covers days from `from`: the recorded side starts the same day.
    const from = split?.from ?? days[0];
    let paid = 0;
    let num = 0;
    let vendor = 0;
    let vendorAll = 0;
    const series = new Map<string, PaygRatioDay>();
    for (const day of days) {
      paid += netPaidByProviderDay.get(provider)?.get(day) ?? 0;
      vendorAll += vendorByProviderDay.get(provider)?.get(day) ?? 0;
      if (day >= from) {
        num += numerator?.get(day) ?? 0;
        vendor += vendorByProviderDay.get(provider)?.get(day) ?? 0;
      }
      series.set(day, {
        cumulativeNetPaidUsdCents: paid,
        cumulativeMeteredUsdCents: round10(num),
        numeratorBasis: basis,
        cumulativeVendorRecordedUsdCents: round10(vendor),
        ratio: num > 0 && vendor > 0 ? round10(num / vendor) : null,
        cumulativeVendorRecordedAllUsdCents: round10(vendorAll),
      });
    }
    out.set(provider, series);
  }
  return out;
}

export type RealCostInputs = {
  days: string[];
  catalogue: CatalogueHistory;
  now: Date;
  /** Email send price (net, US cents per email) per day; absent/null = no email sent yet. */
  emailPriceByDay: Map<string, number | null>;
  /** Subscription key -> day -> real cost per credit (US cents); null = none yet. */
  costPerCreditByDay: Map<string, Map<string, number | null>>;
};

export function realCostSeries(inputs: RealCostInputs): RealCostDay[] {
  const { days, catalogue, now } = inputs;
  const subByProvider = new Map(SUBSCRIPTIONS.map((s) => [s.provider, s]));
  const payg = new Set(PAY_AS_YOU_GO_VENDORS.map((v) => v.provider));
  const out: RealCostDay[] = [];

  for (const day of days) {
    const at = endOfDay(day, now);
    for (const costName of catalogue.names()) {
      const { version } = catalogue.versionAt(costName, at);
      if (!version) continue; // nothing in force yet: no list line on this day
      const vendorCost = version.vendorCost;
      const passThrough = version.pricingBasis === "pass-through";
      const multiplier = passThrough ? PASS_THROUGH_MULTIPLIER : PROPOSED_MULTIPLIER;

      let method: RealCostMethod = "catalogue-vendor-cost";
      let flag: RealCostFlag | null = null;
      let realCost: number | null = vendorCost;
      const ratio: number | null = null;
      let keepPrice = false;

      const share = EMAIL_SEND_COST_SHARES[costName];
      const sub = subByProvider.get(version.provider);
      if (INCLUDED_AT_VENDOR[costName]) {
        method = "included-at-vendor";
        flag = "included-in-another-cost";
        realCost = 0;
      } else if (share !== undefined) {
        const price = inputs.emailPriceByDay.get(day) ?? null;
        if (price !== null) {
          method = "email-send-price";
          realCost = round10(price * share);
        } else flag = "no-email-sent-yet";
      } else if (passThrough) {
        method = "pass-through";
      } else if (sub) {
        if (!sub.creditCostNames.includes(costName)) flag = "not-a-subscription-credit";
        else {
          const perCredit = inputs.costPerCreditByDay.get(sub.key)?.get(day) ?? null;
          if (perCredit !== null) {
            method = "subscription";
            realCost = perCredit;
          } else {
            flag = "no-real-cost-per-credit";
            keepPrice = true;
          }
        }
      } else if (payg.has(version.provider)) {
        // List cost, never a bank/runs ratio: what the bank paid beyond it is internal cost.
        method = "api-list-cost";
      } else if (CATALOGUE_VENDOR_COST_PROVIDERS[version.provider]) {
        flag = "declared-catalogue-vendor-cost";
      } else {
        flag = "no-ledger-line";
      }
      if (realCost === null) {
        flag = flag ?? "no-vendor-cost";
        keepPrice = true;
      }

      let proposedPrice: number | null;
      let proposedBasis: ProposedBasis;
      if (keepPrice) {
        proposedPrice = version.price;
        proposedBasis = version.price === null ? "no-price" : "current-price-kept";
      } else {
        proposedPrice = round10(realCost! * multiplier);
        proposedBasis = passThrough ? "real-cost-x1" : "real-cost-x2";
      }
      let proposedBeforeFloor: number | null = null;
      // A subscription credit is never proposed below what the vendor lists one unit at (owner 2026-10-02).
      if (method === "subscription" && vendorCost !== null && proposedPrice !== null && proposedPrice < vendorCost) {
        proposedBeforeFloor = proposedPrice;
        proposedPrice = vendorCost;
        proposedBasis = "vendor-list-cost-floor";
      }

      out.push({
        day,
        costName,
        provider: version.provider,
        method,
        flag,
        realCost,
        ratio,
        catalogueVendorCost: vendorCost,
        cataloguePrice: version.price,
        multiplier,
        proposedPrice,
        proposedBasis,
        proposedBeforeFloor,
      });
    }
    // A subscription credit runs-service records under a name the catalogue never carried
    // (apollo-enrichment-credit, scrape-do-render-credit...) is still a credit with a real cost.
    for (const sub of SUBSCRIPTIONS) {
      for (const costName of sub.creditCostNames) {
        if (catalogue.versionAt(costName, at).reason !== "not-in-catalogue") continue;
        const perCredit = inputs.costPerCreditByDay.get(sub.key)?.get(day) ?? null;
        out.push({
          day,
          costName,
          provider: sub.provider,
          method: perCredit === null ? "catalogue-vendor-cost" : "subscription",
          flag: perCredit === null ? "no-real-cost-per-credit" : null,
          realCost: perCredit,
          ratio: null,
          catalogueVendorCost: null,
          cataloguePrice: null,
          multiplier: PROPOSED_MULTIPLIER,
          proposedPrice: perCredit === null ? null : round10(perCredit * PROPOSED_MULTIPLIER),
          proposedBasis: perCredit === null ? "no-price" : "real-cost-x2",
          // Not in the catalogue: no vendor list cost to floor at.
          proposedBeforeFloor: null,
        });
      }
    }
    // Email names and included units the catalogue never carried (instantly-email-send, apollo-search-credit).
    const uncatalogued = (name: string) => catalogue.versionAt(name, at).reason === "not-in-catalogue";
    for (const [costName, share] of Object.entries(EMAIL_SEND_COST_SHARES)) {
      if (!uncatalogued(costName)) continue;
      const price = inputs.emailPriceByDay.get(day) ?? null;
      const realCost = price === null ? null : round10(price * share);
      out.push(uncataloguedRow(day, costName, "instantly", price === null ? "catalogue-vendor-cost" : "email-send-price", price === null ? "no-email-sent-yet" : null, realCost));
    }
    for (const costName of Object.keys(INCLUDED_AT_VENDOR)) {
      if (!uncatalogued(costName)) continue;
      out.push(uncataloguedRow(day, costName, null, "included-at-vendor", "included-in-another-cost", 0));
    }
    // A legacy name is priced like its successor that day, every figure copied.
    for (const [costName, { successor }] of Object.entries(LEGACY_COST_NAMES)) {
      if (!uncatalogued(costName)) continue;
      const row = out.find((r) => r.day === day && r.costName === successor);
      if (row) out.push({ ...row, costName, flag: "legacy-name-priced-as-successor" });
    }
  }
  return out;
}

function uncataloguedRow(
  day: string,
  costName: string,
  provider: string | null,
  method: RealCostMethod,
  flag: RealCostFlag | null,
  realCost: number | null,
): RealCostDay {
  return {
    day,
    costName,
    provider,
    method,
    flag,
    realCost,
    ratio: null,
    catalogueVendorCost: null,
    cataloguePrice: null,
    multiplier: PROPOSED_MULTIPLIER,
    proposedPrice: realCost === null ? null : round10(realCost * PROPOSED_MULTIPLIER),
    proposedBasis: realCost === null ? "no-price" : "real-cost-x2",
    proposedBeforeFloor: null,
  };
}

export type GoldPoint = {
  day: string;
  costName: string;
  method: string;
  realCost: number | null;
  ratio: number | null;
  catalogueVendorCost: number | null;
};

/**
 * Real cost of ONE unit consumed on `day`, for replaying consumption (`/internal/price-comparison`).
 *
 * Spend we pay as a lump is spread over EVERY unit since 2026-01-01 at its latest value, so the
 * real cost summed over all units equals what we paid: the email send price and a subscription's
 * cost per credit are since-inception averages whose early values are setup spend over a handful of
 * units (the email price was ~$5 an email on 2026-03-01, over 74 emails). Every other method (an
 * API at its list cost, a catalogue vendor cost) uses the consumption day's own real cost: a vendor
 * price change is a fact of that day.
 */
export function replayRealCost(points: GoldPoint[]): (day: string, costName: string) => number | null {
  const byKey = new Map<string, GoldPoint>();
  const latest = new Map<string, GoldPoint>();
  for (const p of points) {
    byKey.set(`${p.day}|${p.costName}`, p);
    const l = latest.get(p.costName);
    if (!l || p.day > l.day) latest.set(p.costName, p);
  }
  const AMORTIZED = new Set(["email-send-price", "subscription", "included-at-vendor"]);
  return (day, costName) => {
    const last = latest.get(costName);
    const own = byKey.get(`${day}|${costName}`);
    if (!last) return null;
    if (AMORTIZED.has(last.method)) return last.realCost;
    return own ? own.realCost : last.realCost;
  };
}
