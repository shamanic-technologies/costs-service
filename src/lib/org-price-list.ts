import { STANDARD_PRICE_LIST_FROM, type PriceListName } from "./price-lists.js";

/**
 * Which price list an org pays (owner 2026-10-29): created at or after STANDARD_PRICE_LIST_FROM =
 * `standard` (x1, no markup); created before = `grandfathered` (x2, what it paid until then).
 *
 * `createdAt` is client-service's statement for an org it lists as created from the cutoff, or
 * undefined when the org is not in that list. The org is asking for a price, so it exists: absent
 * from the list of orgs created from the cutoff means created before it. This can only err toward
 * the grandfathered list (an org client-service does not list, e.g. a shell), never undercharge an
 * older org.
 */
export function decidePriceList(createdAt: Date | undefined): PriceListName {
  if (createdAt === undefined) return "grandfathered";
  return createdAt.getTime() >= STANDARD_PRICE_LIST_FROM.getTime() ? "standard" : "grandfathered";
}

/** The price an org on `list` pays for a version: the price column (x2) or its x1 standard price. */
export function priceOnList(
  list: PriceListName,
  version: { name: string; costPerUnitInUsdCents: string | null; standardPricePerUnitInUsdCents: string | null; priceSource: string },
): string | null {
  if (list === "grandfathered" || version.costPerUnitInUsdCents === null) return version.costPerUnitInUsdCents;
  if (version.standardPricePerUnitInUsdCents !== null) return version.standardPricePerUnitInUsdCents;
  // A seed/api version the sync has not priced yet is billed at its own price on both lists, as it
  // always was until the sync (the boot prices every in-force version before the port opens). A
  // synced version with no x1 price is a bug: loud, and still never below the vendor list.
  if (version.priceSource === "proposed-list") {
    console.error(`[Costs Service] '${version.name}' has a proposed-list version with no standard (x1) price; serving its grandfathered price`);
  }
  return version.costPerUnitInUsdCents;
}
