import { Router } from "express";
import { requireApiKey } from "../middleware/auth.js";
import { SUBSCRIPTIONS, SUBSCRIPTIONS_SINCE, isCountedSource, type Subscription } from "../lib/subscriptions.js";
import { fromMicros, subscriptionMonthly, type SilverConsumptionDay, type SubscriptionGoldDay } from "../lib/subscription-cost.js";
import { LedgerError } from "../lib/ledger.js";
import { RunsServiceError } from "../lib/runs-service.js";
import { catalogueVersionAt } from "../db/catalogue-version.js";
import { utcDay } from "../db/email-send-price.js";
import {
  readStoredSubscriptionCosts,
  refreshSubscriptionCosts,
  SubscriptionRefreshInProgressError,
} from "../db/subscription-cost.js";
import type { SilverSpendDay } from "../lib/email-send-price.js";

/**
 * The real cost per credit of each vendor subscription — STAFF-ONLY (service api key), read by
 * dashboard v2 Monitoring > Cost > Subscriptions. Everything the page shows is computed here; the
 * reader never divides. Displayed only: no billed price reads it.
 */
const router = Router();
router.use("/internal", requireApiKey);

const usd = (cents: number | null) => (cents === null ? null : Math.round(cents) / 100);
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

function nullReason(sub: Subscription, last: SubscriptionGoldDay): string | null {
  if (last.costPerCreditUsdCents !== null) return null;
  if (sub.ledgerVendors.length === 0) return "no-ledger-line";
  if (last.cumulativeCreditsMicros <= 0) return "no-credit-consumed";
  return "negative-net-paid";
}

async function costItems(sub: Subscription, consumption: SilverConsumptionDay[], at: Date) {
  const names = [
    ...sub.creditCostNames.map((costName) => ({ costName, counted: true, reason: null as string | null })),
    ...sub.excludedCostNames.map((e) => ({ costName: e.costName, counted: false, reason: e.reason })),
  ];
  return Promise.all(
    names.map(async (n) => {
      const own = consumption.filter((c) => c.costName === n.costName);
      const bySource = (source: "platform" | "org") =>
        fromMicros(own.filter((c) => c.costSource === source).reduce((t, c) => t + c.quantityMicros, 0));
      const platform = bySource("platform");
      const org = bySource("org");
      const counted = n.counted ? platform + (isCountedSource(sub, "org") ? org : 0) : 0;
      const version = await catalogueVersionAt(n.costName, at);
      return {
        costName: n.costName,
        isCredit: n.counted,
        excludedReason: n.reason,
        quantityPlatformKey: platform,
        quantityOrgKey: org,
        creditsCounted: counted,
        unit: version.found ? version.row.pc.unit : null,
        billedPricePerUnitInUsdCents: version.found ? num(version.row.pc.costPerUnitInUsdCents) : null,
        vendorCostPerUnitInUsdCents: version.found ? num(version.row.v?.vendorCostPerUnitInUsdCents) : null,
        catalogueNote: version.found ? null : version.reason,
      };
    }),
  );
}

function ledgerVendors(sub: Subscription, spend: SilverSpendDay[]) {
  return sub.ledgerVendors.map((key) => {
    const own = spend.filter((s) => s.vendor === key);
    const paidDays = own.filter((s) => s.paidUsdCents > 0).map((s) => s.day);
    const paid = own.reduce((t, s) => t + s.paidUsdCents, 0);
    const refunded = own.reduce((t, s) => t + s.refundedUsdCents, 0);
    return {
      key,
      firstPaidOn: paidDays[0] ?? null,
      lastPaidOn: paidDays[paidDays.length - 1] ?? null,
      payments: own.reduce((t, s) => t + s.payments, 0),
      refunds: own.reduce((t, s) => t + s.refunds, 0),
      paidUsd: usd(paid),
      refundedUsd: usd(refunded),
      netUsd: usd(paid - refunded),
    };
  });
}

// GET /internal/subscription-costs — the latest stored series (last SUCCEEDED refresh).
router.get("/internal/subscription-costs", async (_req, res) => {
  try {
    const stored = await readStoredSubscriptionCosts();
    const lastRefresh = stored.lastAttempt && {
      status: stored.lastAttempt.status,
      asOf: stored.lastAttempt.asOf,
      startedAt: stored.lastAttempt.startedAt.toISOString(),
      finishedAt: stored.lastAttempt.finishedAt?.toISOString() ?? null,
      error: stored.lastAttempt.error,
    };
    if (!stored.lastSucceeded || stored.series.length === 0) {
      res.status(503).json({ error: "The subscription costs have not been computed yet", lastRefresh });
      return;
    }

    const now = new Date();
    const subscriptions = await Promise.all(
      SUBSCRIPTIONS.map(async (sub) => {
        const series = stored.series.filter((p) => p.subscription === sub.key);
        const last = series[series.length - 1];
        const vendors = ledgerVendors(sub, stored.spend);
        const firstPaid = vendors.map((v) => v.firstPaidOn).filter((d): d is string => d !== null).sort();
        const lastPaid = vendors.map((v) => v.lastPaidOn).filter((d): d is string => d !== null).sort();
        return {
          key: sub.key,
          label: sub.label,
          provider: sub.provider,
          ledgerMatched: sub.ledgerVendors.length > 0,
          ledgerNote: sub.ledgerNote,
          ledgerVendors: vendors,
          firstPaymentOn: firstPaid[0] ?? null,
          lastPaymentOn: lastPaid[lastPaid.length - 1] ?? null,
          paidUsd: usd(last.cumulativePaidUsdCents),
          refundedUsd: usd(last.cumulativeRefundedUsdCents),
          netUsd: usd(last.cumulativeNetUsdCents),
          creditDefinition: sub.creditDefinition,
          orgKeyUnitsCounted: sub.orgKeyRows.count,
          orgKeyUnitsNote: sub.orgKeyRows.count
            ? sub.orgKeyRows.reason
            : "Units through a customer's own key are not credits of our subscription and are not counted",
          credits: fromMicros(last.cumulativeCreditsMicros),
          costPerCreditUsdCents: last.costPerCreditUsdCents,
          grossCostPerCreditUsdCents: last.grossCostPerCreditUsdCents,
          costPerCreditNullReason: nullReason(sub, last),
          costItems: await costItems(sub, stored.consumption, now),
          monthly: subscriptionMonthly(series).map((m) => ({
            month: m.month,
            paidUsd: usd(m.paidUsdCents),
            refundedUsd: usd(m.refundedUsdCents),
            netUsd: usd(m.netUsdCents),
            credits: fromMicros(m.creditsMicros),
            monthCostPerCreditUsdCents: m.monthCostPerCreditUsdCents,
            cumulativeNetUsd: usd(m.cumulativeNetUsdCents),
            cumulativeCredits: fromMicros(m.cumulativeCreditsMicros),
            costPerCreditUsdCents: m.costPerCreditUsdCents,
            grossCostPerCreditUsdCents: m.grossCostPerCreditUsdCents,
          })),
          daily: series.map((p) => ({
            day: p.day,
            paidUsd: usd(p.paidUsdCents),
            netUsd: usd(p.netUsdCents),
            credits: fromMicros(p.creditsMicros),
            cumulativePaidUsd: usd(p.cumulativePaidUsdCents),
            cumulativeNetUsd: usd(p.cumulativeNetUsdCents),
            cumulativeCredits: fromMicros(p.cumulativeCreditsMicros),
            costPerCreditUsdCents: p.costPerCreditUsdCents,
            grossCostPerCreditUsdCents: p.grossCostPerCreditUsdCents,
          })),
        };
      }),
    );

    res.json({
      formula:
        "net paid to the subscription's bank-ledger vendor(s) since 2026-01-01 (paid minus refunded) / credits consumed through our own account since 2026-01-01",
      since: SUBSCRIPTIONS_SINCE,
      asOf: stored.series[stored.series.length - 1].day,
      refreshedAt: stored.lastSucceeded.finishedAt.toISOString(),
      stale: stored.lastSucceeded.asOf < utcDay(now),
      lastRefresh,
      subscriptions,
    });
  } catch (err) {
    console.error("[Costs Service] Error reading the subscription costs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /internal/subscription-costs/refresh — run a refresh now (the daily one runs on its own).
router.post("/internal/subscription-costs/refresh", async (_req, res) => {
  try {
    res.json(await refreshSubscriptionCosts());
  } catch (err) {
    if (err instanceof SubscriptionRefreshInProgressError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof LedgerError || err instanceof RunsServiceError) {
      console.error("[Costs Service] Subscription cost refresh failed upstream:", err.message);
      res.status(502).json({ error: err.message });
      return;
    }
    console.error("[Costs Service] Subscription cost refresh failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
