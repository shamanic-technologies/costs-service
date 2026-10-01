import { and, asc, desc, eq, lt, sql as dsql } from "drizzle-orm";
import { db } from "./index.js";
import {
  consumptionByBrandDaily,
  consumptionByOrgDaily,
  emailSendPriceDaily,
  emailSendPriceRefreshes,
  paygRatioDaily,
  paygVendorPartsDaily,
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
import { fetchGoogleCloudSplit, fetchLedgerVendorPayments, fetchLedgerVendors, type GoogleCloudSplit } from "../lib/ledger.js";
import { fetchGroupedConsumption } from "../lib/runs-service.js";
import { fetchTwilioUsage } from "../lib/twilio-usage.js";
import { CatalogueHistory } from "../lib/catalogue-history.js";
import { PAY_AS_YOU_GO_VENDORS, REAL_COST_SINCE, matchesPrefix, type PayAsYouGoVendor } from "../lib/price-lists.js";
import { paygRatios, realCostSeries, type GoldPoint, type MeteredSpend, type PlatformUnits } from "../lib/real-cost.js";
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

export type VendorPart = { day: string; provider: string; part: string; usdCents: number; basis: string };

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export type VendorSplitRead = { parts: VendorPart[]; raw: unknown; url: string; from: string };

/**
 * A vendor's money split by what it paid for, as the vendor itself reports it. Returns the parts
 * (silver), the raw read (bronze) and the first day the split covers. The `metered` part is the
 * ratio's numerator; every other part is served apart and never loaded on a unit.
 */
export async function readVendorParts(v: PayAsYouGoVendor, asOf: string): Promise<VendorSplitRead> {
  const src = v.meteredSpend!;
  if (src.kind === "google-cloud-split") {
    const read = await fetchGoogleCloudSplit(REAL_COST_SINCE.slice(0, 7));
    return { ...googleCloudParts(read.data, v.provider, src, asOf), raw: read.body, url: read.url };
  }
  const usage = await fetchTwilioUsage(src.account, [...src.meteredCategories, ...src.rentalCategories, "totalprice"], REAL_COST_SINCE, asOf);
  const byDay = new Map<string, { metered: number; rental: number; total: number }>();
  for (const u of usage.daily) {
    const d = byDay.get(u.day) ?? { metered: 0, rental: 0, total: 0 };
    if (src.meteredCategories.includes(u.category)) d.metered += u.usdCents;
    else if (src.rentalCategories.includes(u.category)) d.rental += u.usdCents;
    else d.total += u.usdCents;
    byDay.set(u.day, d);
  }
  const parts: VendorPart[] = [];
  const basis = "Twilio usage records";
  for (const [day, d] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const other = round6(d.total - d.metered - d.rental);
    if (other < -0.01) throw new Error(`Twilio usage on ${day}: categories sum above its total price (${d.metered + d.rental} > ${d.total} cents)`);
    if (d.metered) parts.push({ day, provider: v.provider, part: "metered", usdCents: round6(d.metered), basis: `${basis}: ${src.meteredCategories.join(", ")}` });
    if (d.rental) parts.push({ day, provider: v.provider, part: "rental", usdCents: round6(d.rental), basis: `${basis}: ${src.rentalCategories.join(", ")}` });
    if (other > 0) parts.push({ day, provider: v.provider, part: "other", usdCents: other, basis: `${basis}: totalprice minus the categories above` });
  }
  parts.push({ day: asOf, provider: v.provider, part: "unconsumed-balance", usdCents: usage.balanceUsdCents, basis: "Twilio balance, prepaid and not consumed yet" });
  return { parts, raw: usage.raw, url: "twilio usage records + balance", from: REAL_COST_SINCE };
}

/** The parts a split vendor's metered spend is made of: the ratio's numerator sums exactly these. */
export const COUNTED_PARTS: ReadonlySet<string> = new Set(["metered", "metered-uncovered"]);

/**
 * Google Cloud parts, per day, in US cents. A month's export figures are spread evenly over the days
 * the export covers for it, clipped to [2026-01-01, asOf]: `metered` = `meteredServices` billed to
 * `meteredProjects`; `other-services` = every other service or project; `tax`; `adjustments` (+
 * rounding). In a month the export only half covers, each project's consumption before the export
 * began (`projects[].uncoveredEur`) is spread over the month's days before `coveredFrom`: a metered
 * project's as `metered-uncovered` (counted), any other project's as `other-services-uncovered`. A
 * prepaid top-up lands on the day it was charged. What the export bills that the bank has not
 * collected yet lands on `asOf` as a negative `outstanding`, so the remainder (net paid - every
 * part) is only the bank money no export figure explains. EUR is converted at the bank ledger's own
 * rate on that month's Google Cloud bank lines (or the latest earlier month that has one). The
 * split covers days from the first day a counted part covers.
 */
export function googleCloudParts(
  split: GoogleCloudSplit,
  provider: string,
  src: { meteredServices: readonly string[]; meteredProjects: readonly string[] },
  asOf: string,
): { parts: VendorPart[]; from: string } {
  const months = [...split.months].sort((a, b) => a.month.localeCompare(b.month));
  const rates = new Map<string, { rate: number; from: string }>();
  let last: { rate: number; from: string } | null = null;
  for (const m of months) {
    const lines = m.bank.payments.filter((p) => p.direction === "payment" && p.eurAmount > 0);
    const eur = lines.reduce((t, p) => t + p.eurAmount, 0);
    if (eur > 0) last = { rate: lines.reduce((t, p) => t + p.usdAmount, 0) / eur, from: m.month };
    if (last) rates.set(m.month, last);
  }
  const fxOf = (month: string) => {
    const r = rates.get(month);
    if (!r) throw new Error(`Google Cloud ${month}: no bank line on or before it to convert EUR to USD`);
    return { rate: r.rate, fx: `EUR->USD ${r.rate.toFixed(4)} (ledger rate on ${r.from} Google Cloud bank lines)` };
  };
  const acc = new Map<string, VendorPart>();
  const add = (day: string, part: string, usdCents: number, basis: string) => {
    if (day < REAL_COST_SINCE || day > asOf || usdCents === 0) return;
    const k = `${day}|${part}`;
    const p = acc.get(k) ?? { day, provider, part, usdCents: 0, basis };
    p.usdCents += usdCents;
    acc.set(k, p);
  };
  const isMetered = (projectId: string | null) => projectId !== null && src.meteredProjects.includes(projectId);
  const projectsLabel = src.meteredProjects.join(", ");
  let outstanding = 0;
  const outstandingFx = new Set<string>();
  for (const m of months) {
    if (m.outstandingEur !== 0) {
      const { rate, fx } = fxOf(m.month);
      outstanding += m.outstandingEur * 100 * rate;
      outstandingFx.add(`${m.month} ${fx}`);
    }
    const x = m.export;
    if (!x) continue;
    const { rate, fx } = fxOf(m.month);
    const daysFrom = (from: string, to: string) => {
      const days: string[] = [];
      for (let d = from < REAL_COST_SINCE ? REAL_COST_SINCE : from; d <= to && d <= asOf; d = addDays(d, 1)) days.push(d);
      return days;
    };
    const spread = (days: string[], part: string, eur: number, basis: string) => {
      for (const d of days) add(d, part, (eur * 100 * rate) / days.length, `${basis}; ${fx}`);
    };
    const covered = daysFrom(x.coveredFrom, x.coveredTo);
    const metered = x.projects
      .filter((p) => isMetered(p.projectId))
      .flatMap((p) => p.consumption)
      .filter((c) => src.meteredServices.includes(c.service))
      .reduce((t, c) => t + c.netEur, 0);
    const consumption = x.consumption.reduce((t, c) => t + c.netEur, 0);
    spread(covered, "metered", metered, `GCP billing export, ${src.meteredServices.join(", ")} consumption on ${projectsLabel}`);
    spread(covered, "other-services", consumption - metered, "GCP billing export, every other service or project (Secret Manager, Cloud Run...)");
    spread(covered, "tax", x.taxEur, "Invoice tax, declared recoverable (TAX_IS_REAL_COST = false)");
    spread(covered, "adjustments", x.adjustmentsEur + x.roundingEur, "Invoice adjustments and rounding");
    for (const p of x.prepayments) add(p.chargedOn, "prepaid", p.totalEur * 100 * rate, `Prepaid top-up, counted only as the export shows it consumed; ${fx}`);
    // A half-covered month: what each project consumed before the export began, inferred from the invoice tax.
    const before = x.partial ? daysFrom(`${m.month}-01`, addDays(x.coveredFrom, -1)) : [];
    if (before.length > 0) {
      const unknown = x.projects.filter((p) => isMetered(p.projectId) && p.uncoveredEur === null).map((p) => p.projectId);
      if (unknown.length > 0) throw new Error(`Google Cloud ${m.month}: the ledger cannot infer ${unknown.join(", ")}'s consumption before ${x.coveredFrom} yet`);
      // Another project's gap the ledger cannot infer yet stays in the remainder, visible.
      const gap = (own: boolean) => x.projects.filter((p) => isMetered(p.projectId) === own).reduce((t, p) => t + (p.uncoveredEur ?? 0), 0);
      const basis = `Consumption before the export began (${m.month}-01 to ${addDays(x.coveredFrom, -1)}), inferred by the ledger from the invoice tax (projects[].uncoveredEur)`;
      spread(before, "metered-uncovered", gap(true), `${basis} on ${projectsLabel}, all of it ${src.meteredServices.join(", ")}`);
      spread(before, "other-services-uncovered", gap(false), `${basis} on every other project`);
    }
  }
  if (outstanding !== 0) {
    add(asOf, "outstanding", -outstanding, `Billed by the export, not collected by the bank yet (months[].outstandingEur), as of ${asOf}; ${[...outstandingFx].join("; ")}`);
  }
  const parts = [...acc.values()].map((p) => ({ ...p, usdCents: round6(p.usdCents) })).sort((a, b) => a.day.localeCompare(b.day) || a.part.localeCompare(b.part));
  const counted = parts.filter((p) => COUNTED_PARTS.has(p.part)).map((p) => p.day);
  const exported = months.flatMap((m) => (m.export ? [m.export.coveredFrom] : []));
  const from = [...counted, ...exported].sort()[0];
  if (from === undefined) throw new Error("Google Cloud: the billing export covers no day yet, so Gemini's consumption cannot be told apart");
  return { parts, from: from < REAL_COST_SINCE ? REAL_COST_SINCE : from };
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
    const splitVendors = PAY_AS_YOU_GO_VENDORS.filter((v) => v.meteredSpend);
    const split = await Promise.all(splitVendors.map((v) => readVendorParts(v, asOf).then((r) => ({ provider: v.provider, ...r }))));
    const parts = split.flatMap((x) => x.parts);
    const metered = new Map<string, MeteredSpend>(split.map((x) => [x.provider, { from: x.from, byDay: new Map<string, number>() }]));
    for (const p of parts) {
      if (!COUNTED_PARTS.has(p.part)) continue;
      const m = metered.get(p.provider)!.byDay;
      m.set(p.day, (m.get(p.day) ?? 0) + p.usdCents);
    }

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
    const ratios = paygRatios(days, netPaid, [...unitsByKey.values()], catalogue, now, metered);

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
        cumulativeMeteredUsdCents: r.cumulativeMeteredUsdCents.toFixed(10),
        numeratorBasis: r.numeratorBasis,
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
        ...split.map((x) => ({ source: `vendor-parts-${x.provider}`, url: x.url, body: x.raw })),
      ]) {
        await tx
          .insert(realCostRawReads)
          .values({ readOn: asOf, source: read.source, url: read.url, body: read.body, fetchedAt: now })
          .onConflictDoUpdate({ target: [realCostRawReads.readOn, realCostRawReads.source], set: { url: read.url, body: read.body, fetchedAt: now } });
      }
      await tx.delete(realCostRawReads).where(lt(realCostRawReads.readOn, addDays(asOf, -BRONZE_RETENTION_DAYS)));

      await tx.delete(paygVendorSpendDaily);
      if (spend.length > 0) await tx.insert(paygVendorSpendDaily).values(spend);
      await tx.delete(paygVendorPartsDaily);
      if (parts.length > 0) await tx.insert(paygVendorPartsDaily).values(parts.map((p) => ({ ...p, usdCents: p.usdCents.toFixed(10) })));
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
  // The first tick after boot always recomputes: a deploy can change the formula, and the
  // day's stored series would otherwise keep the old one until tomorrow.
  let booted = false;
  const tick = async () => {
    if (running) return;
    try {
      const today = utcDay(new Date());
      if (booted && await succeededOn(realCostRefreshes, today)) return;
      if (!(await succeededOn(emailSendPriceRefreshes, today)) || !(await succeededOn(subscriptionCostRefreshes, today))) return;
      const outcome = await refreshRealCosts();
      booted = true;
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

/** Every gold point, for replaying consumption at its real cost (`replayRealCost`). */
export async function realCostPoints(): Promise<GoldPoint[]> {
  const rows = await db
    .select({
      day: realUnitCostsDaily.day,
      costName: realUnitCostsDaily.costName,
      method: realUnitCostsDaily.method,
      real: realUnitCostsDaily.realCostUsdCents,
      ratio: realUnitCostsDaily.ratio,
      vendor: realUnitCostsDaily.catalogueVendorCostUsdCents,
    })
    .from(realUnitCostsDaily);
  const n = (v: string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({ day: r.day, costName: r.costName, method: r.method, realCost: n(r.real), ratio: n(r.ratio), catalogueVendorCost: n(r.vendor) }));
}

export async function paygRatiosOnDay(day: string) {
  return db.select().from(paygRatioDaily).where(eq(paygRatioDaily.day, day)).orderBy(asc(paygRatioDaily.provider));
}

export async function paygParts() {
  return db.select().from(paygVendorPartsDaily).orderBy(asc(paygVendorPartsDaily.day));
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
