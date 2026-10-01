/**
 * The REAL cost of one credit of each vendor subscription — a DISPLAYED staff figure, never a
 * billed price (nothing in the catalogue reads it).
 *
 * Owner rule (2026-10-01):
 *
 *   cost per credit (US cents) = net paid to the subscription's ledger vendor(s) since 2026-01-01
 *                                (paid MINUS refunded, bank ledger)
 *                              / credits consumed through OUR account since 2026-01-01
 *                                (runs-service, the cost names declared in `src/lib/subscriptions.ts`)
 *
 * Same machine as the email send price (`src/lib/email-send-price.ts`): recomputed daily, dense
 * per-day series, bronze (raw bodies) / silver (spend per day and vendor, units per day, cost name
 * and key source) / gold (the per-day, per-subscription series below). Gross (refunds ignored) is
 * carried beside the net figure. A cost per credit over zero credits, over a negative net spend,
 * or for a subscription with no ledger line is `null` — never 0, never infinite.
 *
 * Money is integer US cents; quantities are integer MICRO-units (the runs-service quantity has
 * scale 6), so long cumulative sums cannot drift.
 */
import { addDays, type SilverSpendDay } from "./email-send-price.js";
import { isCountedSource, type Subscription } from "./subscriptions.js";

export type CostSource = "platform" | "org";

export type SilverConsumptionDay = {
  day: string;
  costName: string;
  costSource: CostSource;
  /** Micro-units (quantity x 1e6). */
  quantityMicros: number;
  refundedQuantityMicros: number;
};

export type SubscriptionGoldDay = {
  day: string;
  subscription: string;
  /** null = the subscription has no ledger line: what we paid is unknown, not zero. */
  paidUsdCents: number | null;
  refundedUsdCents: number | null;
  netUsdCents: number | null;
  creditsMicros: number;
  cumulativePaidUsdCents: number | null;
  cumulativeRefundedUsdCents: number | null;
  cumulativeNetUsdCents: number | null;
  cumulativeCreditsMicros: number;
  /** US cents per credit since SINCE through this day, on NET paid. */
  costPerCreditUsdCents: number | null;
  /** Same on GROSS paid. */
  grossCostPerCreditUsdCents: number | null;
};

export const MICROS = 1_000_000;
const PRICE_DECIMALS = 6;

/** "142771.000000" -> 142771000000. Exact for any scale-6 decimal string below 9e9 units. */
export function toMicros(quantity: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(quantity.trim());
  if (!m) throw new Error(`Not a decimal quantity: '${quantity}'`);
  const micros = Number(m[2]) * MICROS + Number((m[3] ?? "").padEnd(6, "0"));
  if (!Number.isSafeInteger(micros)) throw new Error(`Quantity too large to sum exactly: '${quantity}'`);
  return m[1] === "-" ? -micros : micros;
}

export function fromMicros(micros: number): number {
  return micros / MICROS;
}

/** US cents per credit, 6 decimals. null over zero credits or a negative spend. */
export function costPerCredit(usdCents: number | null, creditsMicros: number): number | null {
  if (usdCents === null || creditsMicros <= 0 || usdCents < 0) return null;
  const factor = 10 ** PRICE_DECIMALS;
  return Math.round(((usdCents * MICROS) / creditsMicros) * factor) / factor;
}

/** Silver: consumption rows as read, quantities in micro-units. Duplicate keys are an error. */
export function consumptionPerDay(
  days: { day: string; costName: string; costSource: CostSource; quantity: string; refundedQuantity: string }[],
): SilverConsumptionDay[] {
  const seen = new Set<string>();
  const out = days.map((d) => {
    const k = `${d.day}|${d.costName}|${d.costSource}`;
    if (seen.has(k)) throw new Error(`Consumption: ${d.costName} (${d.costSource}) on ${d.day} reported twice`);
    seen.add(k);
    return {
      day: d.day,
      costName: d.costName,
      costSource: d.costSource,
      quantityMicros: toMicros(d.quantity),
      refundedQuantityMicros: toMicros(d.refundedQuantity),
    };
  });
  return out.sort(
    (a, b) => a.day.localeCompare(b.day) || a.costName.localeCompare(b.costName) || a.costSource.localeCompare(b.costSource),
  );
}

/** Whether a consumption row is a credit of this subscription (declared name, counted key source). */
export function isCredit(sub: Subscription, row: { costName: string; costSource: CostSource }): boolean {
  return sub.creditCostNames.includes(row.costName) && isCountedSource(sub, row.costSource);
}

/**
 * Gold for one subscription: one point per calendar day from `since` through `today` (or the last
 * fact, if a bank line is booked later than today UTC).
 */
export function subscriptionSeries(
  sub: Subscription,
  spend: SilverSpendDay[],
  consumption: SilverConsumptionDay[],
  since: string,
  today: string,
): SubscriptionGoldDay[] {
  const matched = sub.ledgerVendors.length > 0;
  const paidByDay = new Map<string, number>();
  const refundedByDay = new Map<string, number>();
  for (const s of spend) {
    if (!sub.ledgerVendors.includes(s.vendor)) continue;
    paidByDay.set(s.day, (paidByDay.get(s.day) ?? 0) + s.paidUsdCents);
    refundedByDay.set(s.day, (refundedByDay.get(s.day) ?? 0) + s.refundedUsdCents);
  }
  const creditsByDay = new Map<string, number>();
  for (const c of consumption) {
    if (!isCredit(sub, c)) continue;
    creditsByDay.set(c.day, (creditsByDay.get(c.day) ?? 0) + c.quantityMicros);
  }

  const lastFact = [...paidByDay.keys(), ...refundedByDay.keys(), ...creditsByDay.keys()].sort().pop();
  const last = lastFact && lastFact > today ? lastFact : today;

  const series: SubscriptionGoldDay[] = [];
  let cumPaid = 0;
  let cumRefunded = 0;
  let cumCredits = 0;
  for (let day = since; day <= last; day = addDays(day, 1)) {
    const paid = paidByDay.get(day) ?? 0;
    const refunded = refundedByDay.get(day) ?? 0;
    const credits = creditsByDay.get(day) ?? 0;
    cumPaid += paid;
    cumRefunded += refunded;
    cumCredits += credits;
    series.push({
      day,
      subscription: sub.key,
      paidUsdCents: matched ? paid : null,
      refundedUsdCents: matched ? refunded : null,
      netUsdCents: matched ? paid - refunded : null,
      creditsMicros: credits,
      cumulativePaidUsdCents: matched ? cumPaid : null,
      cumulativeRefundedUsdCents: matched ? cumRefunded : null,
      cumulativeNetUsdCents: matched ? cumPaid - cumRefunded : null,
      cumulativeCreditsMicros: cumCredits,
      costPerCreditUsdCents: matched ? costPerCredit(cumPaid - cumRefunded, cumCredits) : null,
      grossCostPerCreditUsdCents: matched ? costPerCredit(cumPaid, cumCredits) : null,
    });
  }
  return series;
}

export type SubscriptionMonth = {
  month: string; // YYYY-MM
  paidUsdCents: number | null;
  refundedUsdCents: number | null;
  netUsdCents: number | null;
  creditsMicros: number;
  /** This month alone: net paid in the month / credits consumed in the month. */
  monthCostPerCreditUsdCents: number | null;
  cumulativeNetUsdCents: number | null;
  cumulativeCreditsMicros: number;
  /** Running since SINCE, at the month's last point (month end, or today). */
  costPerCreditUsdCents: number | null;
  grossCostPerCreditUsdCents: number | null;
};

/** Per calendar month of one subscription's series. */
export function subscriptionMonthly(series: SubscriptionGoldDay[]): SubscriptionMonth[] {
  const months = new Map<string, SubscriptionMonth>();
  for (const p of series) {
    const month = p.day.slice(0, 7);
    const m = months.get(month) ?? {
      month,
      paidUsdCents: p.paidUsdCents === null ? null : 0,
      refundedUsdCents: p.refundedUsdCents === null ? null : 0,
      netUsdCents: p.netUsdCents === null ? null : 0,
      creditsMicros: 0,
      monthCostPerCreditUsdCents: null,
      cumulativeNetUsdCents: null,
      cumulativeCreditsMicros: 0,
      costPerCreditUsdCents: null,
      grossCostPerCreditUsdCents: null,
    };
    if (m.paidUsdCents !== null) m.paidUsdCents += p.paidUsdCents!;
    if (m.refundedUsdCents !== null) m.refundedUsdCents += p.refundedUsdCents!;
    if (m.netUsdCents !== null) m.netUsdCents += p.netUsdCents!;
    m.creditsMicros += p.creditsMicros;
    m.cumulativeNetUsdCents = p.cumulativeNetUsdCents;
    m.cumulativeCreditsMicros = p.cumulativeCreditsMicros;
    m.costPerCreditUsdCents = p.costPerCreditUsdCents;
    m.grossCostPerCreditUsdCents = p.grossCostPerCreditUsdCents;
    months.set(month, m);
  }
  return [...months.values()].map((m) => ({ ...m, monthCostPerCreditUsdCents: costPerCredit(m.netUsdCents, m.creditsMicros) }));
}
