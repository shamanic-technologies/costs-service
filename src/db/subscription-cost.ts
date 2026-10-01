import { and, asc, desc, eq, sql as dsql } from "drizzle-orm";
import { db } from "./index.js";
import {
  subscriptionConsumptionDaily,
  subscriptionCostDaily,
  subscriptionCostRawReads,
  subscriptionCostRefreshes,
  subscriptionSpendDaily,
} from "./schema.js";
import {
  SUBSCRIPTIONS,
  SUBSCRIPTIONS_SINCE,
  allSubscriptionCostNames,
  allSubscriptionLedgerVendors,
} from "../lib/subscriptions.js";
import { fetchLedgerVendorPayments } from "../lib/ledger.js";
import { fetchConsumption } from "../lib/runs-service.js";
import { spendPerDayAndVendor, type SilverSpendDay } from "../lib/email-send-price.js";
import {
  consumptionPerDay,
  subscriptionSeries,
  type CostSource,
  type SilverConsumptionDay,
  type SubscriptionGoldDay,
} from "../lib/subscription-cost.js";
import { utcDay } from "./email-send-price.js";

/**
 * Storage and scheduling of the real cost per credit of each subscription (formula and layering:
 * src/lib/subscription-cost.ts). Same contract as the email send price: a refresh reads both
 * upstreams, then rewrites silver and gold WHOLE in one transaction (a late bank line corrects every
 * day it touches; a same-day re-run writes the same rows). A refresh that cannot read an upstream
 * writes nothing but its own `failed` attempt: the last succeeded series stays served, `stale`.
 */

export class SubscriptionRefreshInProgressError extends Error {}

let running = false;

export type SubscriptionRefreshOutcome = { refreshId: string; asOf: string; days: number; subscriptions: number };

export async function refreshSubscriptionCosts(now: Date = new Date()): Promise<SubscriptionRefreshOutcome> {
  if (running) throw new SubscriptionRefreshInProgressError("A subscription cost refresh is already running");
  running = true;
  const asOf = utcDay(now);
  const [attempt] = await db
    .insert(subscriptionCostRefreshes)
    .values({ asOf, status: "running" })
    .returning({ id: subscriptionCostRefreshes.id })
    .catch((err) => {
      running = false;
      throw err;
    });
  try {
    const vendors = allSubscriptionLedgerVendors();
    const costNames = allSubscriptionCostNames();
    const [ledger, consumption] = await Promise.all([
      fetchLedgerVendorPayments(vendors),
      fetchConsumption(costNames, SUBSCRIPTIONS_SINCE),
    ]);

    const unexpectedVendors = ledger.data.payments.filter((p) => !vendors.includes(p.vendor)).map((p) => p.vendor);
    if (unexpectedVendors.length > 0) {
      throw new Error(`Bank ledger returned lines for vendors not asked for: ${[...new Set(unexpectedVendors)].join(", ")}`);
    }
    const unexpectedNames = consumption.parsed.days.filter((d) => !costNames.includes(d.costName)).map((d) => d.costName);
    if (unexpectedNames.length > 0) {
      throw new Error(`runs-service returned cost names not asked for: ${[...new Set(unexpectedNames)].join(", ")}`);
    }
    const early = consumption.parsed.days.find((d) => d.day < SUBSCRIPTIONS_SINCE);
    if (early) throw new Error(`runs-service returned a day before ${SUBSCRIPTIONS_SINCE}: ${early.day}`);

    // Owner start date: nothing before it is wanted (the ledger starts 2026-01-10 anyway).
    const spend = spendPerDayAndVendor(ledger.data.payments.filter((p) => p.bookedOn >= SUBSCRIPTIONS_SINCE));
    const units = consumptionPerDay(consumption.parsed.days);
    const series = SUBSCRIPTIONS.flatMap((s) => subscriptionSeries(s, spend, units, SUBSCRIPTIONS_SINCE, asOf));

    await db.transaction(async (tx) => {
      // Serializes concurrent refreshes across processes; the in-process flag covers this one.
      await tx.execute(dsql`SELECT pg_advisory_xact_lock(hashtext('costs-service:subscription-costs'))`);
      for (const read of [
        { source: "bank-ledger", url: ledger.url, body: ledger.body },
        { source: "runs-service", url: consumption.url, body: consumption.body },
      ]) {
        await tx
          .insert(subscriptionCostRawReads)
          .values({ readOn: asOf, source: read.source, url: read.url, body: read.body, fetchedAt: now })
          .onConflictDoUpdate({
            target: [subscriptionCostRawReads.readOn, subscriptionCostRawReads.source],
            set: { url: read.url, body: read.body, fetchedAt: now },
          });
      }
      await tx.delete(subscriptionSpendDaily);
      if (spend.length > 0) await tx.insert(subscriptionSpendDaily).values(spend);
      await tx.delete(subscriptionConsumptionDaily);
      for (let i = 0; i < units.length; i += 1000) {
        await tx.insert(subscriptionConsumptionDaily).values(units.slice(i, i + 1000));
      }
      await tx.delete(subscriptionCostDaily);
      for (let i = 0; i < series.length; i += 500) {
        await tx.insert(subscriptionCostDaily).values(
          series.slice(i, i + 500).map((p) => ({
            ...p,
            costPerCreditUsdCents: p.costPerCreditUsdCents === null ? null : p.costPerCreditUsdCents.toFixed(6),
            grossCostPerCreditUsdCents: p.grossCostPerCreditUsdCents === null ? null : p.grossCostPerCreditUsdCents.toFixed(6),
            refreshId: attempt.id,
          })),
        );
      }
      await tx
        .update(subscriptionCostRefreshes)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(eq(subscriptionCostRefreshes.id, attempt.id));
    });
    const days = new Set(series.map((p) => p.day)).size;
    return { refreshId: attempt.id, asOf, days, subscriptions: SUBSCRIPTIONS.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(subscriptionCostRefreshes)
      .set({ status: "failed", error: message.slice(0, 2000), finishedAt: new Date() })
      .where(eq(subscriptionCostRefreshes.id, attempt.id));
    throw err;
  } finally {
    running = false;
  }
}

export async function subscriptionCostsSucceededOn(day: string): Promise<boolean> {
  const rows = await db
    .select({ id: subscriptionCostRefreshes.id })
    .from(subscriptionCostRefreshes)
    .where(and(eq(subscriptionCostRefreshes.asOf, day), eq(subscriptionCostRefreshes.status, "succeeded")))
    .limit(1);
  return rows.length > 0;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * In-process daily refresh: an hourly tick refreshes when today (UTC) has no succeeded refresh
 * yet, so a failed attempt is retried within the hour. Started after `listen()`, never awaited.
 */
export function startSubscriptionCostScheduler(intervalMs: number = HOUR_MS): NodeJS.Timeout {
  // The first tick after boot always recomputes: a deploy can change the formula, and the
  // day's stored series would otherwise keep the old one until tomorrow.
  let booted = false;
  const tick = async () => {
    if (running) return;
    try {
      if (booted && await subscriptionCostsSucceededOn(utcDay(new Date()))) return;
      const outcome = await refreshSubscriptionCosts();
      booted = true;
      console.log(`[Costs Service] Subscription costs refreshed as of ${outcome.asOf} (${outcome.days} days)`);
    } catch (err) {
      console.error("[Costs Service] Subscription cost refresh FAILED, last series stays served:", err);
    }
  };
  void tick();
  return setInterval(() => void tick(), intervalMs);
}

// --- Read --------------------------------------------------------------------------------------

export type StoredSubscriptionCosts = {
  lastSucceeded: { id: string; asOf: string; finishedAt: Date } | null;
  lastAttempt: typeof subscriptionCostRefreshes.$inferSelect | null;
  spend: SilverSpendDay[];
  consumption: SilverConsumptionDay[];
  series: SubscriptionGoldDay[];
};

export async function readStoredSubscriptionCosts(): Promise<StoredSubscriptionCosts> {
  const [lastAttempt] = await db
    .select()
    .from(subscriptionCostRefreshes)
    .orderBy(desc(subscriptionCostRefreshes.startedAt))
    .limit(1);
  const [lastSucceeded] = await db
    .select({ id: subscriptionCostRefreshes.id, asOf: subscriptionCostRefreshes.asOf, finishedAt: subscriptionCostRefreshes.finishedAt })
    .from(subscriptionCostRefreshes)
    .where(eq(subscriptionCostRefreshes.status, "succeeded"))
    .orderBy(desc(subscriptionCostRefreshes.finishedAt))
    .limit(1);
  const [spend, consumption, gold] = await Promise.all([
    db.select().from(subscriptionSpendDaily).orderBy(asc(subscriptionSpendDaily.day), asc(subscriptionSpendDaily.vendor)),
    db
      .select()
      .from(subscriptionConsumptionDaily)
      .orderBy(asc(subscriptionConsumptionDaily.day), asc(subscriptionConsumptionDaily.costName)),
    db.select().from(subscriptionCostDaily).orderBy(asc(subscriptionCostDaily.subscription), asc(subscriptionCostDaily.day)),
  ]);
  return {
    lastSucceeded: lastSucceeded ? { id: lastSucceeded.id, asOf: lastSucceeded.asOf, finishedAt: lastSucceeded.finishedAt! } : null,
    lastAttempt: lastAttempt ?? null,
    spend,
    consumption: consumption.map((c) => ({ ...c, costSource: c.costSource as CostSource })),
    series: gold.map(({ refreshId: _r, ...p }) => ({
      ...p,
      costPerCreditUsdCents: p.costPerCreditUsdCents === null ? null : Number(p.costPerCreditUsdCents),
      grossCostPerCreditUsdCents: p.grossCostPerCreditUsdCents === null ? null : Number(p.grossCostPerCreditUsdCents),
    })),
  };
}
