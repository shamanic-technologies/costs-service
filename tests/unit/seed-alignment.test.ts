import { describe, it, expect } from "vitest";
import { CatalogueHistory, type CatalogueVersion } from "../../src/lib/catalogue-history.js";
import { valueOnOrBefore, versionsToAlign } from "../../src/lib/catalogue-sync.js";

// 2026-10-09: a seed version was billed at the seed's 5x markup from its deploy until the first
// sync (5 rows of Sonnet 5.5 cache reads). The boot now selects every version the sync never priced.
const T0 = new Date("2025-01-01T00:00:00Z");
const LAST_SYNC = new Date("2026-10-09T05:01:40Z");
const NOW = new Date("2026-10-09T15:28:43Z");

let n = 0;
const v = (name: string, price: number, at: Date, priceSource: string, createdAt: Date = at): CatalogueVersion => ({
  id: `id-${++n}`,
  name,
  provider: "anthropic",
  planTier: "p",
  billingCycle: "monthly",
  unit: "token",
  pricingBasis: "marked-up",
  price,
  vendorCost: 0.00001,
  effectiveFrom: at,
  createdAt,
  priceSource,
});
const plans = [{ provider: "anthropic", planTier: "p", billingCycle: "monthly", effectiveFrom: T0 }];

describe("versionsToAlign", () => {
  it("selects a reprice and a new (backdated) name the sync never saw, at now", () => {
    const repriced = v("sonnet-cached", 0.00005, new Date("2026-10-09T15:28:42.596Z"), "seed");
    const fresh = v("haiku-input", 0.00005, T0, "seed", new Date("2026-10-09T15:28:42Z"));
    const cat = new CatalogueHistory(
      [v("sonnet-cached", 0.000125, T0, "seed"), v("sonnet-cached", 0.00005, new Date("2026-10-02T05:20:44Z"), "proposed-list"), repriced, fresh],
      plans,
    );
    expect(versionsToAlign(cat, LAST_SYNC, NOW)).toEqual([
      { costName: "haiku-input", versionId: fresh.id, at: NOW },
      { costName: "sonnet-cached", versionId: repriced.id, at: NOW },
    ]);
  });

  it("leaves alone a synced name and a seed version the sync already saw and kept", () => {
    const cat = new CatalogueHistory(
      [
        v("synced", 0.0001, T0, "seed"),
        v("synced", 0.00004, new Date("2026-10-09T05:01:40Z"), "proposed-list"),
        v("kept", 1, T0, "seed", new Date("2026-10-01T00:00:00Z")),
      ],
      plans,
    );
    expect(versionsToAlign(cat, LAST_SYNC, NOW)).toEqual([]);
  });

  it("selects a scheduled version at its own date, once", () => {
    const at = new Date("2026-11-01T16:00:00Z");
    const scheduled = v("deepseek-input", 0.0003, at, "seed", new Date("2026-10-01T00:00:00Z"));
    const base = [v("deepseek-input", 0.0004, T0, "seed"), v("deepseek-input", 0.00016, new Date("2026-10-02T05:20:44Z"), "proposed-list")];
    expect(versionsToAlign(new CatalogueHistory([...base, scheduled], plans), LAST_SYNC, NOW)).toEqual([
      { costName: "deepseek-input", versionId: scheduled.id, at },
    ]);
    const aligned = v("deepseek-input", 0.00012, new Date(at.getTime() + 1), "proposed-list");
    expect(versionsToAlign(new CatalogueHistory([...base, scheduled, aligned], plans), LAST_SYNC, NOW)).toEqual([]);
  });
});

describe("valueOnOrBefore", () => {
  const m = new Map<string, number | null>([
    ["2026-10-07", 1],
    ["2026-10-08", null],
  ]);
  it("reads the day, else the latest day before it, else nothing", () => {
    expect(valueOnOrBefore(m, "2026-10-07")).toBe(1);
    expect(valueOnOrBefore(m, "2026-10-09")).toBeNull();
    expect(valueOnOrBefore(m, "2026-10-06")).toBeUndefined();
  });
});
