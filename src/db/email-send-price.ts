import { and, asc, desc, eq, sql as dsql } from "drizzle-orm";
import { db } from "./index.js";
import {
  emailInfraSpendDaily,
  emailSendPriceDaily,
  emailSendPriceRawReads,
  emailSendPriceRefreshes,
  emailsToLeadsDaily,
} from "./schema.js";
import { EMAIL_INFRA_VENDORS } from "../lib/email-infra-vendors.js";
import { fetchLedgerVendorPayments } from "../lib/ledger.js";
import { fetchEmailsToLeadsPerDay } from "../lib/instantly-service.js";
import { emailsPerDay, priceSeries, spendPerDayAndVendor, type GoldDay, type SilverSpendDay } from "../lib/email-send-price.js";

/**
 * Storage and scheduling of the email send price (formula and layering: src/lib/email-send-price.ts).
 *
 * A refresh reads both upstreams, then rewrites silver and gold WHOLE in one transaction, so a
 * bank line booked late or a send re-attributed upstream corrects every day it touches, and a
 * second refresh the same day writes the same rows (idempotent). A refresh that cannot read an
 * upstream writes nothing but its own `failed` attempt: the last succeeded series stays served
 * with its as-of, never a zero.
 */

export class RefreshInProgressError extends Error {}

let running = false;

export function isRefreshRunning(): boolean {
  return running;
}

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type RefreshOutcome = { refreshId: string; asOf: string; days: number };

export async function refreshEmailSendPrice(now: Date = new Date()): Promise<RefreshOutcome> {
  if (running) throw new RefreshInProgressError("An email send price refresh is already running");
  running = true;
  const asOf = utcDay(now);
  const [attempt] = await db
    .insert(emailSendPriceRefreshes)
    .values({ asOf, status: "running" })
    .returning({ id: emailSendPriceRefreshes.id })
    .catch((err) => {
      running = false;
      throw err;
    });
  try {
    const keys = EMAIL_INFRA_VENDORS.map((v) => v.key);
    const [ledger, sends] = await Promise.all([fetchLedgerVendorPayments(keys), fetchEmailsToLeadsPerDay()]);

    const unexpected = ledger.data.payments.filter((p) => !keys.includes(p.vendor)).map((p) => p.vendor);
    if (unexpected.length > 0) {
      throw new Error(`Bank ledger returned lines for vendors not asked for: ${[...new Set(unexpected)].join(", ")}`);
    }
    const spend = spendPerDayAndVendor(ledger.data.payments);
    const emails = emailsPerDay(sends.parsed.periods.map((p) => ({ day: p.periodStart, toLeads: p.toLeads })));
    const series = priceSeries(spend, emails, asOf);

    await db.transaction(async (tx) => {
      // Serializes concurrent refreshes across processes; the in-process flag covers this one.
      await tx.execute(dsql`SELECT pg_advisory_xact_lock(hashtext('costs-service:email-send-price'))`);
      for (const read of [
        { source: "bank-ledger", url: ledger.url, body: ledger.body },
        { source: "instantly-service", url: sends.url, body: sends.body },
      ]) {
        await tx
          .insert(emailSendPriceRawReads)
          .values({ readOn: asOf, source: read.source, url: read.url, body: read.body, fetchedAt: now })
          .onConflictDoUpdate({
            target: [emailSendPriceRawReads.readOn, emailSendPriceRawReads.source],
            set: { url: read.url, body: read.body, fetchedAt: now },
          });
      }
      await tx.delete(emailInfraSpendDaily);
      if (spend.length > 0) await tx.insert(emailInfraSpendDaily).values(spend);
      await tx.delete(emailsToLeadsDaily);
      if (emails.length > 0) await tx.insert(emailsToLeadsDaily).values(emails);
      await tx.delete(emailSendPriceDaily);
      for (let i = 0; i < series.length; i += 500) {
        await tx.insert(emailSendPriceDaily).values(
          series.slice(i, i + 500).map((p) => ({
            ...p,
            priceUsdCents: p.priceUsdCents === null ? null : p.priceUsdCents.toFixed(4),
            grossPriceUsdCents: p.grossPriceUsdCents === null ? null : p.grossPriceUsdCents.toFixed(4),
            monthPriceUsdCents: p.monthPriceUsdCents === null ? null : p.monthPriceUsdCents.toFixed(4),
            refreshId: attempt.id,
          })),
        );
      }
      await tx
        .update(emailSendPriceRefreshes)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(eq(emailSendPriceRefreshes.id, attempt.id));
    });
    return { refreshId: attempt.id, asOf, days: series.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(emailSendPriceRefreshes)
      .set({ status: "failed", error: message.slice(0, 2000), finishedAt: new Date() })
      .where(eq(emailSendPriceRefreshes.id, attempt.id));
    throw err;
  } finally {
    running = false;
  }
}

export async function hasSucceededOn(day: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailSendPriceRefreshes.id })
    .from(emailSendPriceRefreshes)
    .where(and(eq(emailSendPriceRefreshes.asOf, day), eq(emailSendPriceRefreshes.status, "succeeded")))
    .limit(1);
  return rows.length > 0;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * In-process daily refresh: an hourly tick refreshes when today (UTC) has no succeeded refresh
 * yet, so a failed attempt is retried within the hour. Started after `listen()`, never awaited.
 */
export function startEmailSendPriceScheduler(intervalMs: number = HOUR_MS): NodeJS.Timeout {
  // The first tick after boot always recomputes: a deploy can change the formula (2026-10-01:
  // excluding VAT), and the day's stored series would otherwise keep the old one until tomorrow.
  let booted = false;
  const tick = async () => {
    if (running) return;
    try {
      if (booted && (await hasSucceededOn(utcDay(new Date())))) return;
      const outcome = await refreshEmailSendPrice();
      booted = true;
      console.log(`[Costs Service] Email send price refreshed as of ${outcome.asOf} (${outcome.days} days)`);
    } catch (err) {
      console.error("[Costs Service] Email send price refresh FAILED, last series stays served:", err);
    }
  };
  void tick();
  return setInterval(() => void tick(), intervalMs);
}

// --- Read --------------------------------------------------------------------------------------

export type StoredSeries = {
  lastSucceeded: { id: string; asOf: string; finishedAt: Date } | null;
  lastAttempt: { id: string; asOf: string; status: string; error: string | null; startedAt: Date; finishedAt: Date | null } | null;
  spend: SilverSpendDay[];
  emailDays: { day: string; toLeads: number }[];
  series: GoldDay[];
};

export async function readStoredSeries(): Promise<StoredSeries> {
  const [lastAttempt] = await db
    .select()
    .from(emailSendPriceRefreshes)
    .orderBy(desc(emailSendPriceRefreshes.startedAt))
    .limit(1);
  const [lastSucceeded] = await db
    .select({ id: emailSendPriceRefreshes.id, asOf: emailSendPriceRefreshes.asOf, finishedAt: emailSendPriceRefreshes.finishedAt })
    .from(emailSendPriceRefreshes)
    .where(eq(emailSendPriceRefreshes.status, "succeeded"))
    .orderBy(desc(emailSendPriceRefreshes.finishedAt))
    .limit(1);
  const [spend, emailDays, gold] = await Promise.all([
    db.select().from(emailInfraSpendDaily).orderBy(asc(emailInfraSpendDaily.day), asc(emailInfraSpendDaily.vendor)),
    db.select().from(emailsToLeadsDaily).orderBy(asc(emailsToLeadsDaily.day)),
    db.select().from(emailSendPriceDaily).orderBy(asc(emailSendPriceDaily.day)),
  ]);
  return {
    lastSucceeded: lastSucceeded ? { id: lastSucceeded.id, asOf: lastSucceeded.asOf, finishedAt: lastSucceeded.finishedAt! } : null,
    lastAttempt: lastAttempt ?? null,
    spend,
    emailDays,
    series: gold.map(({ refreshId: _r, ...p }) => ({
      ...p,
      priceUsdCents: p.priceUsdCents === null ? null : Number(p.priceUsdCents),
      grossPriceUsdCents: p.grossPriceUsdCents === null ? null : Number(p.grossPriceUsdCents),
      monthPriceUsdCents: p.monthPriceUsdCents === null ? null : Number(p.monthPriceUsdCents),
    })),
  };
}
