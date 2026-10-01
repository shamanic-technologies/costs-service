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
 *   4. declared pay-as-you-go vendor                     real = catalogue vendor cost(D) x ratio(D)
 *         ratio(D) = net paid to the vendor through D / vendor cost recorded for it through D
 *                    (both since 2026-01-01; recorded = platform-key units x catalogue vendor cost)
 *   5. anything else                                     real = catalogue vendor cost(D), flagged
 *
 * Whenever the specific figure does not exist yet on D (no payment, no usage, no email sent), the
 * item falls back to its catalogue vendor cost with a flag naming why — never 0, never a guess.
 *
 *   proposed(D) = real(D) x 2 (x1 for pass-through); a subscription credit with no real cost per
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
  | "pay-as-you-go-ratio"
  | "catalogue-vendor-cost"
  | "included-at-vendor";

export type RealCostFlag =
  | "no-email-sent-yet"
  | "not-a-subscription-credit"
  | "no-real-cost-per-credit"
  | "no-payment-yet"
  | "no-recorded-usage-yet"
  | "no-ledger-line"
  | "declared-catalogue-vendor-cost"
  | "no-vendor-cost"
  | "included-in-another-cost"
  | "legacy-name-priced-as-successor";

export type ProposedBasis = "real-cost-x2" | "real-cost-x1" | "current-price-kept" | "no-price";

export type RealCostDay = {
  day: string;
  costName: string;
  provider: string | null;
  method: RealCostMethod;
  flag: RealCostFlag | null;
  realCost: number | null;
  /** pay-as-you-go only: net paid / vendor cost recorded, through D. */
  ratio: number | null;
  catalogueVendorCost: number | null;
  cataloguePrice: number | null;
  multiplier: number;
  proposedPrice: number | null;
  proposedBasis: ProposedBasis;
};

export type PaygRatioDay = { cumulativeNetPaidUsdCents: number; cumulativeVendorRecordedUsdCents: number; ratio: number | null };

const round10 = (x: number) => Math.round(x * 1e10) / 1e10;

/** Platform-key units per (day, cost name), quantities as plain numbers. */
export type PlatformUnits = { day: string; costName: string; quantity: number };

/**
 * Per declared pay-as-you-go provider, dense over `days`: cumulative net paid (ledger, US cents)
 * and cumulative vendor cost recorded (platform units x catalogue vendor cost in force that day).
 */
export function paygRatios(
  days: string[],
  netPaidByProviderDay: Map<string, Map<string, number>>,
  units: PlatformUnits[],
  catalogue: CatalogueHistory,
  now: Date,
): Map<string, Map<string, PaygRatioDay>> {
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
    let paid = 0;
    let vendor = 0;
    const series = new Map<string, PaygRatioDay>();
    for (const day of days) {
      paid += netPaidByProviderDay.get(provider)?.get(day) ?? 0;
      vendor += vendorByProviderDay.get(provider)?.get(day) ?? 0;
      series.set(day, {
        cumulativeNetPaidUsdCents: paid,
        cumulativeVendorRecordedUsdCents: round10(vendor),
        ratio: paid > 0 && vendor > 0 ? round10(paid / vendor) : null,
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
  ratios: Map<string, Map<string, PaygRatioDay>>;
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
      let ratio: number | null = null;
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
        const r = inputs.ratios.get(version.provider)?.get(day);
        if (r && r.ratio !== null && vendorCost !== null) {
          method = "pay-as-you-go-ratio";
          ratio = r.ratio;
          realCost = round10(vendorCost * r.ratio);
        } else flag = !r || r.cumulativeNetPaidUsdCents <= 0 ? "no-payment-yet" : "no-recorded-usage-yet";
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
  };
}
