import { desc, eq, inArray, sql as dsql } from "drizzle-orm";
import { db } from "./index.js";
import {
  catalogueSyncs,
  emailSendPriceRefreshes,
  providerCostVendorCosts,
  providersCosts,
  realCostRefreshes,
  subscriptionCostRefreshes,
} from "./schema.js";
import { goldOnDay, loadCatalogueHistory } from "./real-cost.js";
import { utcDay } from "./email-send-price.js";
import { markupOfSynced, planCatalogueSync, type KeptItem } from "../lib/catalogue-sync.js";

/**
 * Applies the day's proposed price list to the billed catalogue (plan: src/lib/catalogue-sync.ts).
 *
 * Fails loud and writes NO price version when the proposed list is not fresh: the latest real-cost
 * refresh attempt must have SUCCEEDED, as of today (UTC), from an email send price and subscription
 * costs computed today. Otherwise the last good catalogue stays billed and the failed attempt is
 * recorded in `catalogue_syncs` with its reason.
 */
export class StaleProposedListError extends Error {}

export type CatalogueSyncOutcome = {
  syncId: string;
  proposedListDay: string;
  versionsWritten: number;
  unchanged: number;
  kept: KeptItem[];
  written: { costName: string; previousPriceUsdCents: string | null; priceUsdCents: string }[];
};

async function assertFresh(today: string) {
  const [last] = await db.select().from(realCostRefreshes).orderBy(desc(realCostRefreshes.startedAt)).limit(1);
  if (!last) throw new StaleProposedListError("The proposed list has never been computed");
  if (last.status !== "succeeded") {
    throw new StaleProposedListError(`The last real-cost refresh is '${last.status}'${last.error ? `: ${last.error}` : ""}`);
  }
  if (last.asOf !== today) throw new StaleProposedListError(`The proposed list is as of ${last.asOf}, not today (${today})`);
  const [email] = last.emailSendPriceRefreshId
    ? await db.select().from(emailSendPriceRefreshes).where(eq(emailSendPriceRefreshes.id, last.emailSendPriceRefreshId))
    : [];
  const [subs] = last.subscriptionCostRefreshId
    ? await db.select().from(subscriptionCostRefreshes).where(eq(subscriptionCostRefreshes.id, last.subscriptionCostRefreshId))
    : [];
  if (email?.asOf !== today) throw new StaleProposedListError(`The proposed list read an email send price as of ${email?.asOf ?? "never"}, not today`);
  if (subs?.asOf !== today) throw new StaleProposedListError(`The proposed list read subscription costs as of ${subs?.asOf ?? "never"}, not today`);
  return last;
}

export async function syncCatalogueToProposed(now: Date = new Date()): Promise<CatalogueSyncOutcome> {
  const today = utcDay(now);
  let refreshId: string | null = null;
  try {
    const refresh = await assertFresh(today);
    refreshId = refresh.id;
    const [items, catalogue] = await Promise.all([goldOnDay(today), loadCatalogueHistory()]);
    if (items.length === 0) throw new StaleProposedListError(`The proposed list of ${today} is empty`);
    const plan = planCatalogueSync(
      items.map((g) => ({
        costName: g.costName,
        method: g.method,
        flag: g.flag,
        proposedBasis: g.proposedBasis,
        proposedPriceUsdCents: g.proposedPriceUsdCents,
        realCostUsdCents: g.realCostUsdCents,
      })),
      catalogue,
      now,
    );

    const syncId = await db.transaction(async (tx) => {
      // Same lock as the seed: a boot seeding the catalogue and a sync never interleave.
      await tx.execute(dsql`SELECT pg_advisory_xact_lock(911001)`);
      const ids = plan.writes.map((w) => w.from.id).filter((x): x is string => !!x);
      const sources = ids.length ? await tx.select().from(providersCosts).where(inArray(providersCosts.id, ids)) : [];
      const byId = new Map(sources.map((r) => [r.id, r]));
      for (const w of plan.writes) {
        const src = w.from.id ? byId.get(w.from.id) : undefined;
        if (!src) throw new Error(`Catalogue sync: the version copied for '${w.costName}' has no row id`);
        const [inserted] = await tx
          .insert(providersCosts)
          .values({
            name: w.costName,
            provider: src.provider,
            providerDomain: src.providerDomain,
            type: src.type,
            unit: src.unit,
            planTier: src.planTier,
            billingCycle: src.billingCycle,
            pricingRegime: src.pricingRegime,
            regimeHoursUtc: src.regimeHoursUtc,
            pricingBasis: src.pricingBasis,
            costPerUnitInUsdCents: w.priceUsdCents,
            priceSource: "proposed-list",
            effectiveFrom: now,
          })
          .returning({ id: providersCosts.id });
        await tx.insert(providerCostVendorCosts).values({
          providerCostId: inserted.id,
          vendorCostPerUnitInUsdCents: w.vendorCostUsdCents,
          markupMultiplier: markupOfSynced(w.priceUsdCents, w.vendorCostUsdCents),
          derivation: w.vendorCostDerivation,
          unknownReason: w.vendorCostUsdCents === null ? "no-vendor-rate-on-record" : null,
        });
      }
      const [row] = await tx
        .insert(catalogueSyncs)
        .values({
          realCostRefreshId: refresh.id,
          proposedListDay: today,
          status: "succeeded",
          versionsWritten: plan.writes.length,
          kept: plan.kept,
          finishedAt: new Date(),
        })
        .returning({ id: catalogueSyncs.id });
      return row.id;
    });

    return {
      syncId,
      proposedListDay: today,
      versionsWritten: plan.writes.length,
      unchanged: plan.unchanged,
      kept: plan.kept,
      written: plan.writes.map((w) => ({ costName: w.costName, previousPriceUsdCents: w.previousPriceUsdCents, priceUsdCents: w.priceUsdCents })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(catalogueSyncs).values({
      realCostRefreshId: refreshId,
      proposedListDay: today,
      status: "failed",
      error: message.slice(0, 2000),
      finishedAt: new Date(),
    });
    throw err;
  }
}

export async function lastCatalogueSyncs(limit = 5) {
  return db.select().from(catalogueSyncs).orderBy(desc(catalogueSyncs.startedAt)).limit(limit);
}
