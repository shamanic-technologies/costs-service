import { and, asc, desc, eq, lt, sql as dsql } from "drizzle-orm";
import { db } from "./index.js";
import {
  consumptionByBrandDaily,
  consumptionByOrgDaily,
  emailSendPriceDaily,
  emailSendPriceRefreshes,
  paygRatioDaily,
  paygVendorSpendDaily,
  platformCosts,
  providerCostVendorCosts,
  providersCosts,
  realCostRawReads,
  realCostRefreshes,
  realUnitCostsDaily,
  subscriptionCostDaily,
  subscriptionCostRefreshes,
} from "./schema.js";
import { addDays, spendPerDayAndVendor } from "../lib/email-send-price.js";
import { fetchLedgerVendorPayments, fetchLedgerVendors } from "../lib/ledger.js";
import { fetchGroupedConsumption } from "../lib/runs-service.js";
import { CatalogueHistory } from "../lib/catalogue-history.js";
import { PAY_AS_YOU_GO_VENDORS, REAL_COST_SINCE, matchesPrefix } from "../lib/price-lists.js";
import { paygRatios, realCostSeries, type PlatformUnits } from "../lib/real-cost.js";
import type { ConsumptionRow } from "../lib/price-comparison.js";
import { utcDay } from "./email-send-price.js";

/**
 * Storage and scheduling of the real cost per unit and the proposed price list (formula:
 * src/lib/real-cost.ts). Same contract as the email send price and the subscription costs: a
 * refresh reads its upstreams, then rewrites silver and gold WHOLE in one transaction; a failed
 * refresh writes only its `failed` attempt and the last series stays served (`stale`).
 *
 * Reads the two sibling golds (email send price, subscription costs) as stored by their own last
 * succeeded refresh, and records which ones it used.
 */

export class RealCostRefreshInProgressError extends Error {}

let running = false;

const BRONZE_RETENTION_DAYS = 30;

export async function loadCatalogueHistory(): Promise<CatalogueHistory> {
  const [rows, plans] = await Promise.all([
    db
      .select({ pc: providersCosts, v: providerCostVendorCosts })
      .from(providersCosts)
      .leftJoin(providerCostVendorCosts, eq(providerCostVendorCosts.providerCostId, providersCosts.id)),
    db.select().from(platformCosts),
  ]);
  return new CatalogueHistory(
    rows.map(({ pc, v }) => ({
      name: pc.name,
      provider: pc.provider,
      planTier: pc.planTier,
      billingCycle: pc.billingCycle,
      unit: pc.unit,
      pricingBasis: pc.pricingBasis,
      price: pc.costPerUnitInUsdCents === null ? null : Number(pc.costPerUnitInUsdCents),
      vendorCost: v?.vendorCostPerUnitInUsdCents == null ? null : Number(v.vendorCostPerUnitInUsdCents),
      effectiveFrom: pc.effectiveFrom,
      createdAt: pc.createdAt,
    })),
    plans.map((p) => ({ provider: p.provider, planTier: p.planTier, billingCycle: p.billingCycle, effectiveFrom: p.effectiveFrom })),
  );
}

async function lastSucceeded(table: typeof emailSendPriceRefreshes | typeof subscriptionCostRefreshes, what: string) {
  const [row] = await db
    .select({ id: table.id, asOf: table.asOf })
    .from(table)
    .where(eq(table.status, "succeeded"))
    .orderBy(desc(table.finishedAt))
    .limit(1);
  if (!row) throw new Error(`The ${what} has never been computed: the real costs read it`);
  return row;
}

/** Ledger keys of every declared pay-as-you-go vendor, prefixes expanded against the ledger's vendor list. */
export function resolvePaygLedgerVendors(ledgerKeys: string[]): Map<string, string> {
  const vendorToProvider = new Map<string, string>();
  for (const v of PAY_AS_YOU_GO_VENDORS) {
    for (const key of v.ledgerVendors) {
      if (!ledgerKeys.includes(key)) throw new Error(`Bank ledger has never paid declared vendor "${key}" (${v.provider})`);
      vendorToProvider.set(key, v.provider);
    }
    if (v.ledgerVendorPrefix) {
      const matched = ledgerKeys.filter((k) => matchesPrefix(k, v.ledgerVendorPrefix!));
      if (matched.length === 0) throw new Error(`No bank-ledger vendor starts with "${v.ledgerVendorPrefix}" (${v.provider})`);
      for (const k of matched) vendorToProvider.set(k, v.provider);
    }
  }
  return vendorToProvider;
}

const silverRow = (d: { day: string; orgId: string | null; costName: string; costSource: string; quantity: string; billedCostInUsdCents: string; netBilledCostInUsdCents: string }) => ({
  day: d.day,
  orgId: d.orgId,
  costName: d.costName,
  costSource: d.costSource,
  quantity: d.quantity,
  billedUsdCents: d.billedCostInUsdCents,
  netBilledUsdCents: d.netBilledCostInUsdCents,
});

export type RealCostRefreshOutcome = { refreshId: string; asOf: string; days: number; costItems: number };

export async function refreshRealCosts(now: Date = new Date()): Promise<RealCostRefreshOutcome> {
  if (running) throw new RealCostRefreshInProgressError("A real cost refresh is already running");
  running = true;
  const asOf = utcDay(now);
  const [attempt] = await db
    .insert(realCostRefreshes)
    .values({ asOf, status: "running" })
    .returning({ id: realCostRefreshes.id })
    .catch((err) => {
      running = false;
      throw err;
    });
  try {
    const [email, subs] = await Promise.all([
      lastSucceeded(emailSendPriceRefreshes, "email send price"),
      lastSucceeded(subscriptionCostRefreshes, "subscription cost"),
    ]);
    const ledgerVendors = await fetchLedgerVendors();
    const vendorToProvider = resolvePaygLedgerVendors(ledgerVendors.vendors.map((v) => v.key));
    const [payments, byOrg, byBrand] = await Promise.all([
      fetchLedgerVendorPayments([...vendorToProvider.keys()]),
      fetchGroupedConsumption(false),
      fetchGroupedConsumption(true),
    ]);
    const unexpected = payments.data.payments.filter((p) => !vendorToProvider.has(p.vendor)).map((p) => p.vendor);
    if (unexpected.length > 0) throw new Error(`Bank ledger returned lines for vendors not asked for: ${[...new Set(unexpected)].join(", ")}`);

    const spend = spendPerDayAndVendor(payments.data.payments.filter((p) => p.bookedOn >= REAL_COST_SINCE)).map((s) => ({
      ...s,
      provider: vendorToProvider.get(s.vendor)!,
    }));
    const netPaid = new Map<string, Map<string, number>>();
    for (const s of spend) {
      const m = netPaid.get(s.provider) ?? new Map<string, number>();
      m.set(s.day, (m.get(s.day) ?? 0) + s.paidUsdCents - s.refundedUsdCents);
      netPaid.set(s.provider, m);
    }

    const unitsByKey = new Map<string, PlatformUnits>();
    for (const d of byOrg.parsed.days) {
      if (d.costSource !== "platform" || d.day < REAL_COST_SINCE) continue;
      const k = `${d.day}|${d.costName}`;
      const u = unitsByKey.get(k) ?? { day: d.day, costName: d.costName, quantity: 0 };
      u.quantity += Number(d.quantity);
      unitsByKey.set(k, u);
    }

    const days: string[] = [];
    for (let d = REAL_COST_SINCE; d <= asOf; d = addDays(d, 1)) days.push(d);
    const catalogue = await loadCatalogueHistory();
    const ratios = paygRatios(days, netPaid, [...unitsByKey.values()], catalogue, now);

    const [emailGold, subGold] = await Promise.all([
      db.select({ day: emailSendPriceDaily.day, price: emailSendPriceDaily.priceUsdCents }).from(emailSendPriceDaily),
      db
        .select({ sub: subscriptionCostDaily.subscription, day: subscriptionCostDaily.day, perCredit: subscriptionCostDaily.costPerCreditUsdCents })
        .from(subscriptionCostDaily),
    ]);
    const emailPriceByDay = new Map(emailGold.map((e) => [e.day, e.price === null ? null : Number(e.price)]));
    const costPerCreditByDay = new Map<string, Map<string, number | null>>();
    for (const s of subGold) {
      const m = costPerCreditByDay.get(s.sub) ?? new Map<string, number | null>();
      m.set(s.day, s.perCredit === null ? null : Number(s.perCredit));
      costPerCreditByDay.set(s.sub, m);
    }

    const series = realCostSeries({ days, catalogue, now, emailPriceByDay, costPerCreditByDay, ratios });
    const ratioRows = [...ratios.entries()].flatMap(([provider, m]) =>
      [...m.entries()].map(([day, r]) => ({
        day,
        provider,
        cumulativeNetPaidUsdCents: r.cumulativeNetPaidUsdCents,
        cumulativeVendorRecordedUsdCents: r.cumulativeVendorRecordedUsdCents.toFixed(10),
        ratio: r.ratio === null ? null : r.ratio.toFixed(10),
      })),
    );
    const fixed = (x: number | null) => (x === null ? null : x.toFixed(10));

    await db.transaction(async (tx) => {
      await tx.execute(dsql`SELECT pg_advisory_xact_lock(hashtext('costs-service:real-costs'))`);
      for (const read of [
        { source: "bank-ledger-vendors", url: "/api/v1/vendors", body: ledgerVendors },
        { source: "bank-ledger-payments", url: payments.url, body: payments.body },
        { source: "runs-service-by-org", url: byOrg.url, body: byOrg.body },
        { source: "runs-service-by-brand", url: byBrand.url, body: byBrand.body },
      ]) {
        await tx
          .insert(realCostRawReads)
          .values({ readOn: asOf, source: read.source, url: read.url, body: read.body, fetchedAt: now })
          .onConflictDoUpdate({ target: [realCostRawReads.readOn, realCostRawReads.source], set: { url: read.url, body: read.body, fetchedAt: now } });
      }
      await tx.delete(realCostRawReads).where(lt(realCostRawReads.readOn, addDays(asOf, -BRONZE_RETENTION_DAYS)));

      await tx.delete(paygVendorSpendDaily);
      if (spend.length > 0) await tx.insert(paygVendorSpendDaily).values(spend);
      await tx.delete(consumptionByOrgDaily);
      for (let i = 0; i < byOrg.parsed.days.length; i += 1000) {
        await tx.insert(consumptionByOrgDaily).values(byOrg.parsed.days.slice(i, i + 1000).map(silverRow));
      }
      await tx.delete(consumptionByBrandDaily);
      for (let i = 0; i < byBrand.parsed.days.length; i += 1000) {
        await tx
          .insert(consumptionByBrandDaily)
          .values(byBrand.parsed.days.slice(i, i + 1000).map((d) => ({ ...silverRow(d), brandId: d.brandId ?? null })));
      }
      await tx.delete(paygRatioDaily);
      for (let i = 0; i < ratioRows.length; i += 1000) await tx.insert(paygRatioDaily).values(ratioRows.slice(i, i + 1000));
      await tx.delete(realUnitCostsDaily);
      for (let i = 0; i < series.length; i += 1000) {
        await tx.insert(realUnitCostsDaily).values(
          series.slice(i, i + 1000).map((r) => ({
            day: r.day,
            costName: r.costName,
            provider: r.provider,
            method: r.method,
            flag: r.flag,
            realCostUsdCents: fixed(r.realCost),
            ratio: fixed(r.ratio),
            catalogueVendorCostUsdCents: fixed(r.catalogueVendorCost),
            cataloguePriceUsdCents: fixed(r.cataloguePrice),
            multiplier: r.multiplier.toFixed(2),
            proposedPriceUsdCents: fixed(r.proposedPrice),
            proposedBasis: r.proposedBasis,
            refreshId: attempt.id,
          })),
        );
      }
      await tx
        .update(realCostRefreshes)
        .set({ status: "succeeded", finishedAt: new Date(), emailSendPriceRefreshId: email.id, subscriptionCostRefreshId: subs.id })
        .where(eq(realCostRefreshes.id, attempt.id));
    });
    return { refreshId: attempt.id, asOf, days: days.length, costItems: new Set(series.map((r) => r.costName)).size };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(realCostRefreshes)
      .set({ status: "failed", error: message.slice(0, 2000), finishedAt: new Date() })
      .where(eq(realCostRefreshes.id, attempt.id));
    throw err;
  } finally {
    running = false;
  }
}

async function succeededOn(table: typeof realCostRefreshes | typeof emailSendPriceRefreshes | typeof subscriptionCostRefreshes, day: string) {
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.asOf, day), eq(table.status, "succeeded")))
    .limit(1);
  return rows.length > 0;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Hourly tick: refreshes once today's email send price and subscription costs have succeeded and
 * today's real costs have not. Started after `listen()`, never awaited.
 */
export function startRealCostScheduler(intervalMs: number = HOUR_MS): NodeJS.Timeout {
  const tick = async () => {
    if (running) return;
    try {
      const today = utcDay(new Date());
      if (await succeededOn(realCostRefreshes, today)) return;
      if (!(await succeededOn(emailSendPriceRefreshes, today)) || !(await succeededOn(subscriptionCostRefreshes, today))) return;
      const outcome = await refreshRealCosts();
      console.log(`[Costs Service] Real costs refreshed as of ${outcome.asOf} (${outcome.costItems} cost items)`);
    } catch (err) {
      console.error("[Costs Service] Real cost refresh FAILED, last series stays served:", err);
    }
  };
  // First tick after the sibling refreshes had a chance to run on boot.
  setTimeout(() => void tick(), 5 * 60 * 1000).unref();
  return setInterval(() => void tick(), intervalMs);
}

// --- Read --------------------------------------------------------------------------------------

export async function realCostRefreshState() {
  const [lastAttempt] = await db.select().from(realCostRefreshes).orderBy(desc(realCostRefreshes.startedAt)).limit(1);
  const [lastSucceededRun] = await db
    .select()
    .from(realCostRefreshes)
    .where(eq(realCostRefreshes.status, "succeeded"))
    .orderBy(desc(realCostRefreshes.finishedAt))
    .limit(1);
  return { lastAttempt: lastAttempt ?? null, lastSucceeded: lastSucceededRun ?? null };
}

export type GoldRow = typeof realUnitCostsDaily.$inferSelect;

export async function goldOnDay(day: string): Promise<GoldRow[]> {
  return db.select().from(realUnitCostsDaily).where(eq(realUnitCostsDaily.day, day)).orderBy(asc(realUnitCostsDaily.costName));
}

export async function goldForCostName(costName: string): Promise<GoldRow[]> {
  return db.select().from(realUnitCostsDaily).where(eq(realUnitCostsDaily.costName, costName)).orderBy(asc(realUnitCostsDaily.day));
}

/** `${day}|${costName}` -> real cost per unit (US cents). */
export async function realCostMap(): Promise<Map<string, number | null>> {
  const rows = await db
    .select({ day: realUnitCostsDaily.day, costName: realUnitCostsDaily.costName, real: realUnitCostsDaily.realCostUsdCents })
    .from(realUnitCostsDaily);
  return new Map(rows.map((r) => [`${r.day}|${r.costName}`, r.real === null ? null : Number(r.real)]));
}

export async function paygRatiosOnDay(day: string) {
  return db.select().from(paygRatioDaily).where(eq(paygRatioDaily.day, day)).orderBy(asc(paygRatioDaily.provider));
}

export async function paygSpend() {
  return db.select().from(paygVendorSpendDaily).orderBy(asc(paygVendorSpendDaily.day));
}

const toRow = (r: { day: string; orgId: string | null; brandId?: string | null; costName: string; costSource: string; quantity: string; billedUsdCents: string; netBilledUsdCents: string }): ConsumptionRow => ({
  day: r.day,
  orgId: r.orgId,
  brandId: r.brandId,
  costName: r.costName,
  costSource: r.costSource as "platform" | "org",
  quantity: Number(r.quantity),
  billed: Number(r.billedUsdCents),
  netBilled: Number(r.netBilledUsdCents),
});

/** Org grain: the whole fleet, or one org. Never brand rows (a co-branded run counts once per brand there). */
export async function consumptionByOrg(orgId?: string): Promise<ConsumptionRow[]> {
  const rows = await db.select().from(consumptionByOrgDaily).where(orgId ? eq(consumptionByOrgDaily.orgId, orgId) : undefined);
  return rows.map(toRow);
}

/** Brand grain: one org x brand, or (no args) every brand row for the fleet ranking. */
export async function consumptionByBrand(orgId?: string, brandId?: string): Promise<ConsumptionRow[]> {
  const where = orgId && brandId ? and(eq(consumptionByBrandDaily.orgId, orgId), eq(consumptionByBrandDaily.brandId, brandId)) : undefined;
  const rows = await db.select().from(consumptionByBrandDaily).where(where);
  return rows.map(toRow);
}
