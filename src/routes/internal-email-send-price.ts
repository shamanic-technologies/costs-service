import { Router } from "express";
import { requireApiKey } from "../middleware/auth.js";
import { EMAIL_INFRA_VENDORS, EXCLUDED_EMAIL_VENDORS } from "../lib/email-infra-vendors.js";
import { monthlyRollup } from "../lib/email-send-price.js";
import { LedgerError } from "../lib/ledger.js";
import { InstantlyServiceError } from "../lib/instantly-service.js";
import { readStoredSeries, refreshEmailSendPrice, RefreshInProgressError, utcDay } from "../db/email-send-price.js";

/**
 * The price of one cold email sent to a lead — STAFF-ONLY (service api key), read by dashboard v2
 * Monitoring > Price. Everything the page shows is computed here; the reader never divides.
 * Displayed only: no billed price reads it.
 */
const router = Router();
router.use("/internal", requireApiKey);

const usd = (cents: number) => Math.round(cents) / 100;

// GET /internal/email-send-price — the latest stored series (last SUCCEEDED refresh).
router.get("/internal/email-send-price", async (_req, res) => {
  try {
    const stored = await readStoredSeries();
    const lastRefresh = stored.lastAttempt && {
      status: stored.lastAttempt.status,
      asOf: stored.lastAttempt.asOf,
      startedAt: stored.lastAttempt.startedAt.toISOString(),
      finishedAt: stored.lastAttempt.finishedAt?.toISOString() ?? null,
      error: stored.lastAttempt.error,
    };
    if (!stored.lastSucceeded || stored.series.length === 0) {
      res.status(503).json({ error: "The email send price has not been computed yet", lastRefresh });
      return;
    }

    const today = utcDay(new Date());
    const latest = stored.series[stored.series.length - 1];
    const keys = EMAIL_INFRA_VENDORS.map((v) => v.key);
    const firstPaymentOn = stored.spend.find((s) => s.paidUsdCents > 0)?.day ?? null;

    res.json({
      formula: "everything paid to the email-infrastructure vendors since inception (gross, refunds not subtracted) / every email sent to a lead since inception",
      asOf: latest.day,
      refreshedAt: stored.lastSucceeded.finishedAt.toISOString(),
      stale: stored.lastSucceeded.asOf < today,
      lastRefresh,
      currentPriceUsdCents: latest.priceUsdCents,
      currentMonthPriceUsdCents: latest.monthPriceUsdCents,
      totals: {
        spendUsd: usd(latest.cumulativeSpendUsdCents),
        refundedUsd: usd(stored.spend.reduce((t, s) => t + s.refundedUsdCents, 0)),
        emailsToLeads: latest.cumulativeEmailsToLeads,
      },
      firstPaymentOn,
      firstSendOn: stored.emailDays[0]?.day ?? null,
      vendors: EMAIL_INFRA_VENDORS.map((v) => {
        const own = stored.spend.filter((s) => s.vendor === v.key);
        const paidDays = own.filter((s) => s.paidUsdCents > 0).map((s) => s.day);
        const paid = own.reduce((t, s) => t + s.paidUsdCents, 0);
        const refunded = own.reduce((t, s) => t + s.refundedUsdCents, 0);
        return {
          key: v.key,
          label: v.label,
          what: v.what,
          firstPaidOn: paidDays[0] ?? null,
          lastPaidOn: paidDays[paidDays.length - 1] ?? null,
          payments: own.reduce((t, s) => t + s.payments, 0),
          refunds: own.reduce((t, s) => t + s.refunds, 0),
          paidUsd: usd(paid),
          refundedUsd: usd(refunded),
          netUsd: usd(paid - refunded),
        };
      }),
      excludedVendors: EXCLUDED_EMAIL_VENDORS,
      monthly: monthlyRollup(stored.spend, stored.series, keys).map((m) => ({
        month: m.month,
        spendUsd: usd(m.spendUsdCents),
        spendByVendorUsd: Object.fromEntries(Object.entries(m.spendByVendorUsdCents).map(([k, c]) => [k, usd(c)])),
        emailsToLeads: m.emailsToLeads,
        monthPriceUsdCents: m.monthPriceUsdCents,
        cumulativeSpendUsd: usd(m.cumulativeSpendUsdCents),
        cumulativeEmailsToLeads: m.cumulativeEmailsToLeads,
        priceUsdCents: m.priceUsdCents,
      })),
      daily: stored.series.map((p) => ({
        day: p.day,
        spendUsd: usd(p.spendUsdCents),
        emailsToLeads: p.emailsToLeads,
        cumulativeSpendUsd: usd(p.cumulativeSpendUsdCents),
        cumulativeEmailsToLeads: p.cumulativeEmailsToLeads,
        priceUsdCents: p.priceUsdCents,
        monthToDateSpendUsd: usd(p.monthToDateSpendUsdCents),
        monthToDateEmailsToLeads: p.monthToDateEmailsToLeads,
        monthPriceUsdCents: p.monthPriceUsdCents,
      })),
    });
  } catch (err) {
    console.error("[Costs Service] Error reading the email send price:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /internal/email-send-price/refresh — run a refresh now (the daily one runs on its own).
router.post("/internal/email-send-price/refresh", async (_req, res) => {
  try {
    const outcome = await refreshEmailSendPrice();
    res.json(outcome);
  } catch (err) {
    if (err instanceof RefreshInProgressError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof LedgerError || err instanceof InstantlyServiceError) {
      console.error("[Costs Service] Email send price refresh failed upstream:", err.message);
      res.status(502).json({ error: err.message });
      return;
    }
    console.error("[Costs Service] Email send price refresh failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
