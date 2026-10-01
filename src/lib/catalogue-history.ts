/**
 * The catalogue as it stood at any instant, resolved in memory over the whole price history
 * (`providers_costs` + `provider_cost_vendor_costs` + `platform_costs`), so a 274-day series over
 * every cost name costs one read of three tables instead of a query per (name, day).
 *
 * In force at `at` = the same resolution as `/v1/platform-prices/:name`: the provider of the
 * name's newest version effective by `at`, that provider's plan effective by `at`, and the
 * newest version of the name on that plan effective by `at`. Versions overwritten in place before
 * v0.25.0 are not in the table, so an early date resolves to the oldest version that survived.
 */
export type CatalogueVersion = {
  name: string;
  provider: string;
  planTier: string;
  billingCycle: string;
  unit: string;
  pricingBasis: string;
  /** Billed price per unit, US cents; null = delisted (no billable price any more). */
  price: number | null;
  /** Vendor cost per unit, US cents; null = not stated. */
  vendorCost: number | null;
  effectiveFrom: Date;
  createdAt: Date;
};

export type CataloguePlan = { provider: string; planTier: string; billingCycle: string; effectiveFrom: Date };

export class CatalogueHistory {
  private readonly byName = new Map<string, CatalogueVersion[]>();
  private readonly plansByProvider = new Map<string, CataloguePlan[]>();

  constructor(versions: CatalogueVersion[], plans: CataloguePlan[]) {
    const newestFirst = (a: CatalogueVersion, b: CatalogueVersion) =>
      b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime();
    for (const v of versions) {
      const list = this.byName.get(v.name) ?? [];
      list.push(v);
      this.byName.set(v.name, list);
    }
    for (const list of this.byName.values()) list.sort(newestFirst);
    for (const p of plans) {
      const list = this.plansByProvider.get(p.provider) ?? [];
      list.push(p);
      this.plansByProvider.set(p.provider, list);
    }
    for (const list of this.plansByProvider.values()) list.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  }

  names(): string[] {
    return [...this.byName.keys()].sort();
  }

  /** The version in force at `at`, or why there is none. */
  versionAt(name: string, at: Date): { version: CatalogueVersion; reason: null } | { version: null; reason: string } {
    const t = at.getTime();
    const versions = this.byName.get(name);
    if (!versions) return { version: null, reason: "not-in-catalogue" };
    const newest = versions.find((v) => v.effectiveFrom.getTime() <= t);
    if (!newest) return { version: null, reason: "not-yet-effective" };
    const plan = (this.plansByProvider.get(newest.provider) ?? []).find((p) => p.effectiveFrom.getTime() <= t);
    if (!plan) return { version: null, reason: "no-platform-plan" };
    const version = versions.find(
      (v) => v.effectiveFrom.getTime() <= t && v.planTier === plan.planTier && v.billingCycle === plan.billingCycle,
    );
    if (!version) return { version: null, reason: "no-version-on-plan" };
    return { version, reason: null };
  }
}

/** The instant a DAY's list is read at: the day's last millisecond, or now for today. */
export function endOfDay(day: string, now: Date = new Date()): Date {
  const end = new Date(`${day}T23:59:59.999Z`);
  return end.getTime() > now.getTime() ? now : end;
}
