import { describe, it, expect, vi } from "vitest";
import { decidePriceList, priceOnList } from "../../src/lib/org-price-list.js";
import { STANDARD_MULTIPLIER, PROPOSED_MULTIPLIER, STANDARD_PRICE_LIST_FROM } from "../../src/lib/price-lists.js";

// Owner 2026-10-29: new accounts pay the vendor list price (x1), accounts created before keep x2.
describe("which price list an org pays (PRICE-X1-1029)", () => {
  it("declares x1 for new accounts and x2 for grandfathered ones", () => {
    expect(STANDARD_MULTIPLIER).toBe(1);
    expect(PROPOSED_MULTIPLIER).toBe(2);
  });

  it("an org created at or after the ship is on the standard list; one created before is grandfathered", () => {
    expect(decidePriceList(STANDARD_PRICE_LIST_FROM)).toBe("standard");
    expect(decidePriceList(new Date(STANDARD_PRICE_LIST_FROM.getTime() + 60_000))).toBe("standard");
    expect(decidePriceList(new Date(STANDARD_PRICE_LIST_FROM.getTime() - 1))).toBe("grandfathered");
  });

  it("an org client-service does not list as created from the ship is grandfathered: never undercharges an older org", () => {
    expect(decidePriceList(undefined)).toBe("grandfathered");
  });
});

describe("the price an org pays for a version", () => {
  const synced = { name: "x", costPerUnitInUsdCents: "0.0200000000", standardPricePerUnitInUsdCents: "0.0100000000", priceSource: "proposed-list" };

  it("worked example: a $0.010 vendor cost is billed $0.010 to a new org, $0.020 to an existing one", () => {
    expect(priceOnList("standard", synced)).toBe("0.0100000000");
    expect(priceOnList("grandfathered", synced)).toBe("0.0200000000");
  });

  it("a delisted version has no price on either list", () => {
    const delisted = { ...synced, costPerUnitInUsdCents: null, standardPricePerUnitInUsdCents: null };
    expect(priceOnList("standard", delisted)).toBeNull();
    expect(priceOnList("grandfathered", delisted)).toBeNull();
  });

  it("a seed version not yet priced by the sync is billed at its own price on both lists, as before the sync", () => {
    const seed = { ...synced, standardPricePerUnitInUsdCents: null, priceSource: "seed" };
    expect(priceOnList("standard", seed)).toBe("0.0200000000");
  });

  it("a synced version with no x1 price is logged loud", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(priceOnList("standard", { ...synced, standardPricePerUnitInUsdCents: null })).toBe("0.0200000000");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
