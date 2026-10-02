/**
 * The proposed price list IS the billed catalogue price (owner go 2026-10-02, supersedes the
 * 2026-08-24 "absorb email infrastructure, markup x5" decision).
 *
 * After every succeeded real-cost refresh, each cost item's proposed price of the day becomes a
 * new catalogue version (`providers_costs`, `price_source = 'proposed-list'`, effective now()),
 * whenever it differs from the version in force. Append-only like every price change: past cost
 * rows keep the price they froze, and the history of every switch is queryable by date.
 *
 * This module only PLANS the writes (pure); `src/db/catalogue-sync.ts` gates and applies them.
 *
 * Rules, per item of the day's proposed list:
 * - no proposed price (`no-price`)                      -> nothing written, the current price stays (kept, flagged)
 * - proposed price 0 on anything but an `included-at-vendor` unit -> the whole sync fails (nothing silently becomes 0)
 * - proposed price = the billed price in force          -> nothing written (current-price-kept items land here)
 * - otherwise                                           -> one new version, metadata copied from the version it supersedes
 * - a cost name the catalogue never carried (a subscription credit, a legacy or email name runs-service
 *   recorded) gets its first version with the metadata of a TEMPLATE name of the same family, so the
 *   billed catalogue covers every item the proposed list prices; no template in force = kept, flagged.
 */
import type { CatalogueHistory, CatalogueVersion } from "./catalogue-history.js";
import { EMAIL_SEND_COST_SHARES, LEGACY_COST_NAMES } from "./price-lists.js";
import { SUBSCRIPTIONS } from "./subscriptions.js";

/** One item of the day's proposed list, as stored in gold (`real_unit_costs_daily`). */
export type ProposedItem = {
  costName: string;
  method: string;
  flag: string | null;
  proposedBasis: string;
  /** numeric(18,10) as text; null = no proposed price. */
  proposedPriceUsdCents: string | null;
  realCostUsdCents: string | null;
};

export type PlannedVersion = {
  costName: string;
  /** The version whose metadata is copied: the one superseded, or the template's for a new name. */
  from: CatalogueVersion;
  /** Set when `from` belongs to another cost name (first version of an uncatalogued name). */
  templateName: string | null;
  priceUsdCents: string;
  previousPriceUsdCents: string | null;
  vendorCostUsdCents: string | null;
  vendorCostDerivation: "proposed-list" | "proposed-list-real-cost" | "unknown";
};

export type KeptItem = { costName: string; reason: string; billedPriceUsdCents: string | null };

export type CatalogueSyncPlan = { writes: PlannedVersion[]; kept: KeptItem[]; unchanged: number };

export class ZeroProposedPriceError extends Error {}

const cents = (x: number | string) => Number(x).toFixed(10);

/**
 * The catalogued name whose metadata (provider, plan, unit, basis) a cost name the catalogue never
 * carried borrows: a legacy name -> its successor; an email name -> another email name; a
 * subscription credit (or a unit the subscription excludes) -> a catalogued credit of that subscription.
 */
export function catalogueTemplateName(costName: string, catalogue: CatalogueHistory, at: Date): string | null {
  const inForce = (n: string) => n !== costName && catalogue.versionAt(n, at).version !== null;
  const legacy = LEGACY_COST_NAMES[costName];
  if (legacy) return inForce(legacy.successor) ? legacy.successor : null;
  if (EMAIL_SEND_COST_SHARES[costName] !== undefined) return Object.keys(EMAIL_SEND_COST_SHARES).find(inForce) ?? null;
  for (const sub of SUBSCRIPTIONS) {
    if (sub.creditCostNames.includes(costName) || sub.excludedCostNames.some((e) => e.costName === costName)) {
      return sub.creditCostNames.find(inForce) ?? null;
    }
  }
  return null;
}

export function planCatalogueSync(items: ProposedItem[], catalogue: CatalogueHistory, now: Date): CatalogueSyncPlan {
  const writes: PlannedVersion[] = [];
  const kept: KeptItem[] = [];
  let unchanged = 0;

  for (const item of items) {
    const resolved = catalogue.versionAt(item.costName, now);
    let from = resolved.version;
    let templateName: string | null = null;
    if (!from) {
      if (resolved.reason !== "not-in-catalogue") {
        kept.push({ costName: item.costName, reason: `not billable in the catalogue now (${resolved.reason})`, billedPriceUsdCents: null });
        continue;
      }
      templateName = catalogueTemplateName(item.costName, catalogue, now);
      from = templateName ? catalogue.versionAt(templateName, now).version : null;
      if (!from) {
        kept.push({ costName: item.costName, reason: "not in the catalogue and no catalogued name of its family to copy", billedPriceUsdCents: null });
        continue;
      }
    }
    const billed = templateName || from.price === null ? null : cents(from.price);

    if (item.proposedPriceUsdCents === null) {
      kept.push({ costName: item.costName, reason: `no proposed price (${item.proposedBasis}${item.flag ? `, ${item.flag}` : ""})`, billedPriceUsdCents: billed });
      continue;
    }
    const proposed = cents(item.proposedPriceUsdCents);
    if (Number(proposed) === 0 && item.method !== "included-at-vendor") {
      throw new ZeroProposedPriceError(
        `Proposed price of '${item.costName}' is 0 (method ${item.method}): only a unit declared included at the vendor may be billed 0`,
      );
    }
    if (item.proposedBasis === "current-price-kept") {
      kept.push({ costName: item.costName, reason: `current price kept (${item.flag ?? "no real cost"})`, billedPriceUsdCents: billed });
    }
    if (billed === proposed) {
      unchanged++;
      continue;
    }

    // The vendor rate does not move with the billed price: it is carried from the version copied.
    // Where no vendor rate exists (email infrastructure, a unit included at the vendor), what one
    // unit really costs us is the real cost the proposed price was computed from.
    let vendorCostUsdCents: string | null = null;
    let vendorCostDerivation: PlannedVersion["vendorCostDerivation"] = "unknown";
    if (from.vendorCost !== null && !templateName) {
      vendorCostUsdCents = cents(from.vendorCost);
      vendorCostDerivation = "proposed-list";
    } else if (from.vendorCost !== null && templateName && LEGACY_COST_NAMES[item.costName]) {
      vendorCostUsdCents = cents(from.vendorCost);
      vendorCostDerivation = "proposed-list";
    } else if ((item.method === "email-send-price" || item.method === "included-at-vendor") && item.realCostUsdCents !== null) {
      vendorCostUsdCents = cents(item.realCostUsdCents);
      vendorCostDerivation = "proposed-list-real-cost";
    }

    writes.push({
      costName: item.costName,
      from,
      templateName,
      priceUsdCents: proposed,
      previousPriceUsdCents: billed,
      vendorCostUsdCents,
      vendorCostDerivation,
    });
  }
  return { writes, kept, unchanged };
}

/** billed / vendor at 4 decimals; null when the vendor cost is unknown or zero. */
export function markupOfSynced(price: string, vendor: string | null): string | null {
  if (vendor === null || Number(vendor) === 0) return null;
  return (Number(price) / Number(vendor)).toFixed(4);
}
