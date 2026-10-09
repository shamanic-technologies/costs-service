import { desc, eq, inArray, sql as dsql, type SQL } from "drizzle-orm";
import { db } from "./index.js";
import {
  catalogueSyncs,
  emailSendPriceDaily,
  emailSendPriceRefreshes,
  providerCostVendorCosts,
  providersCosts,
  realCostRefreshes,
  subscriptionCostDaily,
  subscriptionCostRefreshes,
} from "./schema.js";
import { goldOnDay, loadCatalogueHistory } from "./real-cost.js";
import { utcDay } from "./email-send-price.js";
import {
  markupOfSynced,
  planCatalogueSync,
  valueOnOrBefore,
  versionsToAlign,
  type KeptItem,
  type PlannedVersion,
  type ProposedItem,
} from "../lib/catalogue-sync.js";
import { realCostSeries } from "../lib/real-cost.js";

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Appends each planned version (and its vendor-cost row), effective at the instant given per write. */
async function insertPlannedVersions(tx: Tx, writes: PlannedVersion[], effectiveFrom: (w: PlannedVersion) => Date | SQL) {
  const ids = writes.map((w) => w.from.id).filter((x): x is string => !!x);
  const sources = ids.length ? await tx.select().from(providersCosts).where(inArray(providersCosts.id, ids)) : [];
  const byId = new Map(sources.map((r) => [r.id, r]));
  for (const w of writes) {
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
        effectiveFrom: effectiveFrom(w),
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
      await insertPlannedVersions(tx, plan.writes, () => now);
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

export type SeedAlignmentOutcome = {
  /** Null when no sync ever succeeded (the seed price is then the billed price by design). */
  lastSyncStartedAt: Date | null;
  candidates: number;
  versionsWritten: number;
  unchanged: number;
  kept: KeptItem[];
  written: { costName: string; previousPriceUsdCents: string | null; priceUsdCents: string; at: string }[];
};

/**
 * Prices, at boot and BEFORE the port opens, every seed version the proposed list has not priced
 * yet (selection: `versionsToAlign`), with the same formula and rules as the daily sync
 * (`realCostSeries` + `planCatalogueSync`) read from what this database already holds: the
 * catalogue just seeded with its vendor costs, the email send price and subscription costs of the
 * day (or the latest day before it). No network read, so the boot stays fast.
 *
 * So no seed version is ever billed at the seed's markup: a version in force gets its proposed
 * version at the boot instant, while nothing serves yet; a scheduled one gets it at its own date
 * + 1 microsecond (the unique key forbids the same instant). The scheduler's refresh still runs
 * after boot and corrects anything the latest stored inputs got wrong, as it always did.
 */
export async function alignSeedVersionsToProposedList(now: Date = new Date()): Promise<SeedAlignmentOutcome> {
  const [lastSync] = await db
    .select({ startedAt: catalogueSyncs.startedAt })
    .from(catalogueSyncs)
    .where(eq(catalogueSyncs.status, "succeeded"))
    .orderBy(desc(catalogueSyncs.startedAt))
    .limit(1);
  const empty = { candidates: 0, versionsWritten: 0, unchanged: 0, kept: [], written: [] };
  if (!lastSync) return { lastSyncStartedAt: null, ...empty };

  const catalogue = await loadCatalogueHistory();
  const candidates = versionsToAlign(catalogue, lastSync.startedAt, now);
  if (candidates.length === 0) return { lastSyncStartedAt: lastSync.startedAt, ...empty };

  const [emailGold, subGold] = await Promise.all([
    db.select({ day: emailSendPriceDaily.day, price: emailSendPriceDaily.priceUsdCents }).from(emailSendPriceDaily),
    db
      .select({ sub: subscriptionCostDaily.subscription, day: subscriptionCostDaily.day, perCredit: subscriptionCostDaily.costPerCreditUsdCents })
      .from(subscriptionCostDaily),
  ]);
  const emailByDay = new Map(emailGold.map((e) => [e.day, e.price === null ? null : Number(e.price)]));
  const perCreditBySub = new Map<string, Map<string, number | null>>();
  for (const s of subGold) {
    const m = perCreditBySub.get(s.sub) ?? new Map<string, number | null>();
    m.set(s.day, s.perCredit === null ? null : Number(s.perCredit));
    perCreditBySub.set(s.sub, m);
  }

  const byInstant = new Map<number, typeof candidates>();
  for (const c of candidates) byInstant.set(c.at.getTime(), [...(byInstant.get(c.at.getTime()) ?? []), c]);

  const fixed = (x: number | null) => (x === null ? null : x.toFixed(10));
  const writes: { w: PlannedVersion; versionId: string }[] = [];
  const kept: KeptItem[] = [];
  let unchanged = 0;
  for (const [t, group] of byInstant) {
    const at = new Date(t);
    const day = utcDay(at);
    const email = valueOnOrBefore(emailByDay, day);
    const series = realCostSeries({
      days: [day],
      catalogue,
      now: at,
      emailPriceByDay: new Map(email === undefined ? [] : [[day, email]]),
      costPerCreditByDay: new Map(
        [...perCreditBySub].map(([sub, m]) => {
          const v = valueOnOrBefore(m, day);
          return [sub, new Map(v === undefined ? [] : [[day, v]])];
        }),
      ),
    });
    const names = new Map(group.map((c) => [c.costName, c.versionId]));
    const items: ProposedItem[] = series
      .filter((r) => names.has(r.costName))
      .map((r) => ({
        costName: r.costName,
        method: r.method,
        flag: r.flag,
        proposedBasis: r.proposedBasis,
        proposedPriceUsdCents: fixed(r.proposedPrice),
        realCostUsdCents: fixed(r.realCost),
      }));
    const plan = planCatalogueSync(items, catalogue, at);
    for (const w of plan.writes) writes.push({ w, versionId: names.get(w.costName)! });
    kept.push(...plan.kept);
    unchanged += plan.unchanged;
  }

  if (writes.length > 0) {
    const versionOf = new Map(writes.map((x) => [x.w, x.versionId]));
    const at = new Map(writes.map((x) => [x.w, candidates.find((c) => c.versionId === x.versionId)!.at]));
    await db.transaction(async (tx) => {
      // Same lock as the seed and the sync: none of the three interleave.
      await tx.execute(dsql`SELECT pg_advisory_xact_lock(911001)`);
      await insertPlannedVersions(
        tx,
        writes.map((x) => x.w),
        // Strictly after the version it prices, never before now: the row's own effective_from
        // is read in SQL because a JS Date drops its microseconds.
        (w) =>
          dsql`GREATEST(${now.toISOString()}::timestamptz, (SELECT pc.effective_from FROM providers_costs pc WHERE pc.id = ${versionOf.get(w)!}::uuid) + interval '1 microsecond')`,
      );
    });
    return {
      lastSyncStartedAt: lastSync.startedAt,
      candidates: candidates.length,
      versionsWritten: writes.length,
      unchanged,
      kept,
      written: writes.map(({ w }) => ({
        costName: w.costName,
        previousPriceUsdCents: w.previousPriceUsdCents,
        priceUsdCents: w.priceUsdCents,
        at: at.get(w)!.toISOString(),
      })),
    };
  }
  return { lastSyncStartedAt: lastSync.startedAt, candidates: candidates.length, versionsWritten: 0, unchanged, kept, written: [] };
}
