/**
 * What sending ONE cold email to a lead really costs us. Since 2026-10-02 this is ALSO what every
 * customer is billed per email (real cost x the org's list multiplier, `src/lib/real-cost.ts` +
 * the catalogue sync), so the formula is a billing rule.
 *
 * Owner rule (EMAIL-PRICE-CURRENT-1123, 2026-11-23, REPLACES the 2026-10-01 since-inception rule):
 *
 *   price per email on day D (US cents) = what the email infrastructure costs per day on D
 *                                         / emails sent to leads per day (the 30 full days before D)
 *
 *   cost per day on D = sum, over every vendor payment whose covered period includes D, of
 *                       payment / days it covers (`src/lib/email-infra-coverage.ts`: a monthly plan
 *                       covers its month, a domain registration its year)
 *
 * Money paid for a period that is over is sunk: it loads no email sent after it (owner: the ~$5,300
 * paid since inception is never re-billed). No payment covering D = price 0, not null and not the old
 * average; a price over zero emails is null.
 *
 * Do NOT restore the since-inception average as the price: it kept billing ~2.69c per email for
 * mailboxes and plans the owner had already cut. It is still computed and served beside, labelled
 * `sinceInceptionPriceUsdCents` (net) / `grossPriceUsdCents` (gross), so the change stays visible.
 * Each day also carries the MONTH-ALONE cash figure (month-to-date spend / month-to-date emails).
 *
 * Layering (pure functions here; storage in `src/db/email-send-price.ts`):
 *   bronze = the raw ledger and instantly-service bodies as read
 *   silver = spend per (day, vendor) in USD, each bank line with its covered period, emails per day
 *   gold   = the per-day series below
 *
 * Spend is NET (owner, 2026-10-01: "total consommé"): a refund is spread negative over its own term.
 * Money is summed in integer US cents for the cumulative figures; the per-day cost is fractional cents.
 */

import { LedgerError } from "./ledger.js";
import { linesCovering, perDayUsdCents, type CoveredLine } from "./email-infra-coverage.js";

export type SpendLine = {
  id: string;
  vendor: string;
  bookedOn: string; // YYYY-MM-DD
  direction: "payment" | "refund";
  usdAmount: number; // always positive; direction carries the sign
  vat: {
    source: "bank" | "declared" | "unknown";
    rate: number | null;
    evidence: string | null;
    excludingVat: { usdAmount: number } | null;
    vat: { usdAmount: number } | null;
  };
};

/**
 * A bank line whose VAT the ledger cannot state. Its cost excluding VAT is unknown, so no figure
 * built on it is computed (never read as 0% or as a guessed rate): the refresh fails, naming the
 * lines, and the previous series stays served, stale.
 */
export class UnknownVatError extends LedgerError {}

export type SendDay = { day: string; toLeads: number };

export type SilverSpendDay = {
  day: string;
  vendor: string;
  /** Excluding VAT (owner 2026-10-01: VAT we are charged is recoverable, so it is not a cost). */
  paidUsdCents: number;
  refundedUsdCents: number;
  /** The VAT taken out of the bank amounts above; paid + vatPaid = what the bank paid. */
  vatPaidUsdCents: number;
  vatRefundedUsdCents: number;
  /** Where each VAT figure comes from: source, rate and evidence, as the ledger states them. */
  vatBasis: string | null;
  payments: number;
  refunds: number;
};

export type GoldDay = {
  day: string;
  /** Net (paid - refunded) that day; negative on a day the vendors gave back more than we paid. */
  spendUsdCents: number;
  emailsToLeads: number;
  cumulativeSpendUsdCents: number;
  cumulativeEmailsToLeads: number;
  /**
   * THE price (EMAIL-PRICE-CURRENT-1123): runningCostUsdCentsPerDay / trailingEmailsPerDay. 0 when no
   * payment covers the day; null when the 30 days before sent nothing (or the running cost is negative).
   */
  priceUsdCents: number | null;
  /** What the email infrastructure costs per day on this day: every covering payment / its covered days. */
  runningCostUsdCentsPerDay: number;
  /** Emails to leads per day over the 30 full days before this day (fewer at the start of the series). */
  trailingEmailsPerDay: number;
  /** The superseded 2026-10-01 figure, served beside: NET spend since inception / emails since inception. */
  sinceInceptionPriceUsdCents: number | null;
  /** Gross: every payment since inception, refunds ignored. */
  cumulativePaidUsdCents: number;
  /** US cents per email on GROSS paid, since inception. */
  grossPriceUsdCents: number | null;
  monthToDateSpendUsdCents: number;
  monthToDateEmailsToLeads: number;
  /** US cents per email, this calendar month alone through this day. null when the month sent nothing yet. */
  monthPriceUsdCents: number | null;
};

const PRICE_DECIMALS = 4;

export function toUsdCents(usd: number): number {
  return Math.round(usd * 100);
}

export function pricePerEmail(spendUsdCents: number, emails: number): number | null {
  if (emails === 0 || spendUsdCents < 0) return null;
  const factor = 10 ** PRICE_DECIMALS;
  return Math.round((spendUsdCents / emails) * factor) / factor;
}

const roundTo = (x: number, decimals: number) => Math.round(x * 10 ** decimals) / 10 ** decimals;

/** The current price: cost per day / emails per day. 0 when nothing covers the day, null over zero emails. */
export function currentPricePerEmail(runningCostUsdCentsPerDay: number, emailsPerDay: number): number | null {
  if (emailsPerDay === 0 || runningCostUsdCentsPerDay < 0) return null;
  return roundTo(runningCostUsdCentsPerDay / emailsPerDay, PRICE_DECIMALS);
}

/** One VAT basis as served: "declared 20%: <evidence>". */
export function vatBasisOf(vat: SpendLine["vat"]): string {
  const rate = vat.rate === null ? "rate not stated" : `${Math.round(vat.rate * 10000) / 100}%`;
  return `${vat.source} ${rate}${vat.evidence ? `: ${vat.evidence}` : ""}`;
}

/** Every distinct basis in `bases`, joined; null when there is none. */
export function joinVatBases(bases: (string | null)[]): string | null {
  const all = [...new Set(bases.flatMap((b) => (b ? b.split(" | ") : [])))];
  return all.length > 0 ? all.join(" | ") : null;
}

/**
 * The VAT taken out of a set of silver rows: net (paid minus refunded) in US cents, and every basis
 * it rests on. `null` basis on a row = written before the ledger served VAT.
 */
export function vatTakenOut(rows: SilverSpendDay[]): { vatUsdCents: number; vatBasis: string | null } {
  return {
    vatUsdCents: rows.reduce((t, r) => t + r.vatPaidUsdCents - r.vatRefundedUsdCents, 0),
    vatBasis: joinVatBases(rows.map((r) => r.vatBasis)),
  };
}

/**
 * Silver: one row per (day, vendor) with any line, payments and refunds apart, EXCLUDING VAT, the
 * VAT taken out beside it. Sorted by day, vendor. A line whose VAT is unknown fails loud.
 */
export function spendPerDayAndVendor(lines: SpendLine[]): SilverSpendDay[] {
  const unknown = lines.filter((l) => l.vat.source === "unknown" || l.vat.excludingVat === null);
  if (unknown.length > 0) {
    throw new UnknownVatError(
      `The bank ledger cannot state the VAT of ${unknown.length} line(s), so their cost excluding VAT is unknown: ${unknown
        .slice(0, 10)
        .map((l) => `${l.vendor} ${l.bookedOn} ${l.id}`)
        .join(", ")}`,
    );
  }
  const byKey = new Map<string, SilverSpendDay & { bases: Set<string> }>();
  for (const line of lines) {
    const k = `${line.bookedOn}|${line.vendor}`;
    let row = byKey.get(k);
    if (!row) {
      row = { day: line.bookedOn, vendor: line.vendor, paidUsdCents: 0, refundedUsdCents: 0, vatPaidUsdCents: 0, vatRefundedUsdCents: 0, vatBasis: null, payments: 0, refunds: 0, bases: new Set() };
      byKey.set(k, row);
    }
    // VAT = the bank amount minus the amount excluding it, so the two always add back to the bank to the cent.
    const gross = toUsdCents(Math.abs(line.usdAmount));
    const cents = toUsdCents(Math.abs(line.vat.excludingVat!.usdAmount));
    row.bases.add(vatBasisOf(line.vat));
    if (line.direction === "payment") {
      row.paidUsdCents += cents;
      row.vatPaidUsdCents += gross - cents;
      row.payments += 1;
    } else {
      row.refundedUsdCents += cents;
      row.vatRefundedUsdCents += gross - cents;
      row.refunds += 1;
    }
  }
  return [...byKey.values()]
    .map(({ bases, ...row }) => ({ ...row, vatBasis: [...bases].sort().join(" | ") }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.vendor.localeCompare(b.vendor));
}

/** Silver: emails to leads per day, zero days dropped (gold re-densifies). Duplicate days are an error. */
export function emailsPerDay(days: SendDay[]): SendDay[] {
  const seen = new Set<string>();
  for (const d of days) {
    if (seen.has(d.day)) throw new Error(`Emails to leads: day ${d.day} reported twice`);
    seen.add(d.day);
  }
  return days.filter((d) => d.toLeads > 0).sort((a, b) => a.day.localeCompare(b.day));
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Gold: one point per calendar day from the first fact (first payment or first send, whichever
 * came first) through `today` (or the last fact, if a bank line is booked later than today UTC).
 * Empty when there is no fact at all.
 */
export const TRAILING_EMAIL_DAYS = 30;

export function priceSeries(spend: SilverSpendDay[], emails: SendDay[], covered: CoveredLine[], today: string): GoldDay[] {
  const spendByDay = new Map<string, number>();
  const paidByDay = new Map<string, number>();
  for (const s of spend) {
    spendByDay.set(s.day, (spendByDay.get(s.day) ?? 0) + s.paidUsdCents - s.refundedUsdCents);
    paidByDay.set(s.day, (paidByDay.get(s.day) ?? 0) + s.paidUsdCents);
  }
  const emailsByDay = new Map(emails.map((e) => [e.day, e.toLeads]));

  const factDays = [...spendByDay.keys(), ...emailsByDay.keys()].sort();
  if (factDays.length === 0) return [];
  const first = factDays[0];
  const last = factDays[factDays.length - 1] > today ? factDays[factDays.length - 1] : today;

  const series: GoldDay[] = [];
  const trailing: number[] = [];
  let trailingEmails = 0;
  let cumSpend = 0;
  let cumPaid = 0;
  let cumEmails = 0;
  let mtdSpend = 0;
  let mtdEmails = 0;
  for (let day = first; day <= last; day = addDays(day, 1)) {
    if (day.slice(8) === "01") {
      mtdSpend = 0;
      mtdEmails = 0;
    }
    const spendToday = spendByDay.get(day) ?? 0;
    const emailsToday = emailsByDay.get(day) ?? 0;
    cumSpend += spendToday;
    cumPaid += paidByDay.get(day) ?? 0;
    cumEmails += emailsToday;
    mtdSpend += spendToday;
    mtdEmails += emailsToday;
    // The window holds the full days BEFORE `day`: today's own sends are partial until midnight.
    const trailingEmailsPerDay = trailing.length === 0 ? 0 : trailingEmails / trailing.length;
    const runningCost = linesCovering(covered, day).reduce((t, l) => t + perDayUsdCents(l), 0);
    series.push({
      day,
      spendUsdCents: spendToday,
      emailsToLeads: emailsToday,
      cumulativeSpendUsdCents: cumSpend,
      cumulativeEmailsToLeads: cumEmails,
      priceUsdCents: currentPricePerEmail(runningCost, trailingEmailsPerDay),
      runningCostUsdCentsPerDay: roundTo(runningCost, PRICE_DECIMALS),
      trailingEmailsPerDay: roundTo(trailingEmailsPerDay, PRICE_DECIMALS),
      sinceInceptionPriceUsdCents: pricePerEmail(cumSpend, cumEmails),
      cumulativePaidUsdCents: cumPaid,
      grossPriceUsdCents: pricePerEmail(cumPaid, cumEmails),
      monthToDateSpendUsdCents: mtdSpend,
      monthToDateEmailsToLeads: mtdEmails,
      monthPriceUsdCents: pricePerEmail(mtdSpend, mtdEmails),
    });
    trailing.push(emailsToday);
    trailingEmails += emailsToday;
    if (trailing.length > TRAILING_EMAIL_DAYS) trailingEmails -= trailing.shift()!;
  }
  return series;
}

export type MonthRollup = {
  month: string; // YYYY-MM
  spendUsdCents: number;
  /** Net per vendor key that month. */
  spendByVendorUsdCents: Record<string, number>;
  paidUsdCents: number;
  refundedUsdCents: number;
  emailsToLeads: number;
  monthPriceUsdCents: number | null;
  cumulativeSpendUsdCents: number;
  cumulativeEmailsToLeads: number;
  /** The current price at the month's last day in the series (month end, or today). */
  priceUsdCents: number | null;
  /** The superseded since-inception price at that same day. */
  sinceInceptionPriceUsdCents: number | null;
  cumulativePaidUsdCents: number;
  grossPriceUsdCents: number | null;
};

/** Per calendar month: spend per vendor, emails, both prices at the month's last point. */
export function monthlyRollup(spend: SilverSpendDay[], series: GoldDay[], vendorKeys: readonly string[]): MonthRollup[] {
  const lastPointByMonth = new Map<string, GoldDay>();
  for (const p of series) lastPointByMonth.set(p.day.slice(0, 7), p);
  const byVendor = new Map<string, Record<string, number>>();
  const paid = new Map<string, number>();
  const refunded = new Map<string, number>();
  for (const s of spend) {
    const month = s.day.slice(0, 7);
    paid.set(month, (paid.get(month) ?? 0) + s.paidUsdCents);
    refunded.set(month, (refunded.get(month) ?? 0) + s.refundedUsdCents);
    let row = byVendor.get(month);
    if (!row) {
      row = Object.fromEntries(vendorKeys.map((k) => [k, 0]));
      byVendor.set(month, row);
    }
    row[s.vendor] = (row[s.vendor] ?? 0) + s.paidUsdCents - s.refundedUsdCents;
  }
  return [...lastPointByMonth.entries()].map(([month, p]) => ({
    month,
    spendUsdCents: p.monthToDateSpendUsdCents,
    spendByVendorUsdCents: byVendor.get(month) ?? Object.fromEntries(vendorKeys.map((k) => [k, 0])),
    paidUsdCents: paid.get(month) ?? 0,
    refundedUsdCents: refunded.get(month) ?? 0,
    emailsToLeads: p.monthToDateEmailsToLeads,
    monthPriceUsdCents: p.monthPriceUsdCents,
    cumulativeSpendUsdCents: p.cumulativeSpendUsdCents,
    cumulativeEmailsToLeads: p.cumulativeEmailsToLeads,
    priceUsdCents: p.priceUsdCents,
    sinceInceptionPriceUsdCents: p.sinceInceptionPriceUsdCents,
    cumulativePaidUsdCents: p.cumulativePaidUsdCents,
    grossPriceUsdCents: p.grossPriceUsdCents,
  }));
}

/** Owner rule 2026-10-01: every real cost is EXCLUDING VAT (the VAT we are charged is recoverable). */
export const VAT_RULE =
  "Every money figure is EXCLUDING VAT: the VAT a vendor charged is recoverable, so it is not a cost. vatUsd = the VAT taken out of what the bank paid (net of refunds), vatBasis = where the bank ledger read it (bank VAT field, or a declared rate per vendor with its evidence). A line whose VAT the ledger cannot state fails the refresh: it is never read as 0% or a guessed rate.";

/** The VAT taken out, served beside a money figure: US dollars + its basis. */
export const vatServed = (rows: SilverSpendDay[]) => {
  const v = vatTakenOut(rows);
  return { vatUsd: Math.round(v.vatUsdCents) / 100, vatBasis: v.vatBasis };
};
