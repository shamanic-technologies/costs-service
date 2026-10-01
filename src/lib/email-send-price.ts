/**
 * What sending ONE cold email to a lead really costs us — a DISPLAYED staff figure, never a
 * billed price (nothing in the catalogue reads it).
 *
 * Owner rule (LOCKED 2026-10-01):
 *
 *   price per email (US cents) = everything ever consumed from the email-infrastructure vendors
 *                                (`EMAIL_INFRA_VENDORS`, since inception, all included,
 *                                paid MINUS refunded: a refunded purchase was not consumed)
 *                              / every email ever sent to a lead (`outreach` sends, since inception)
 *
 * Recomputed daily and kept as a dense per-day series so a reader can chart how it converged.
 * Each day also carries the MONTH-ALONE price (month-to-date spend / month-to-date emails) so
 * both curves come from the producer and no reader divides.
 *
 * Layering (pure functions here; storage in `src/db/email-send-price.ts`):
 *   bronze = the raw ledger and instantly-service bodies as read
 *   silver = spend per (day, vendor) in USD, emails to leads per day
 *   gold   = the per-day series below
 *
 * Spend is NET (owner, 2026-10-01: "total consommé"). The GROSS figure (every payment line,
 * refunds ignored — what the first brief measured, ~3.34c) is carried beside it on every point
 * as `cumulativePaid*` / `grossPriceUsdCents`, so a reader can show both and see the gap.
 * A price over a NEGATIVE spend (a month whose refunds exceed its payments) does not exist:
 * `null`, like a price over zero emails.
 *
 * Money is summed in integer US cents (the ledger rounds each line to the cent), so a long
 * cumulative sum cannot drift. A price over zero emails is `null`, never zero and never infinite.
 */

export type SpendLine = {
  vendor: string;
  bookedOn: string; // YYYY-MM-DD
  direction: "payment" | "refund";
  usdAmount: number; // always positive; direction carries the sign
};

export type SendDay = { day: string; toLeads: number };

export type SilverSpendDay = {
  day: string;
  vendor: string;
  paidUsdCents: number;
  refundedUsdCents: number;
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
  /** US cents per email on NET spend, since inception through this day. null while no email was ever sent. */
  priceUsdCents: number | null;
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

/** Silver: one row per (day, vendor) with any line, payments and refunds apart. Sorted by day, vendor. */
export function spendPerDayAndVendor(lines: SpendLine[]): SilverSpendDay[] {
  const byKey = new Map<string, SilverSpendDay>();
  for (const line of lines) {
    const k = `${line.bookedOn}|${line.vendor}`;
    let row = byKey.get(k);
    if (!row) {
      row = { day: line.bookedOn, vendor: line.vendor, paidUsdCents: 0, refundedUsdCents: 0, payments: 0, refunds: 0 };
      byKey.set(k, row);
    }
    const cents = toUsdCents(Math.abs(line.usdAmount));
    if (line.direction === "payment") {
      row.paidUsdCents += cents;
      row.payments += 1;
    } else {
      row.refundedUsdCents += cents;
      row.refunds += 1;
    }
  }
  return [...byKey.values()].sort((a, b) => a.day.localeCompare(b.day) || a.vendor.localeCompare(b.vendor));
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
export function priceSeries(spend: SilverSpendDay[], emails: SendDay[], today: string): GoldDay[] {
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
    series.push({
      day,
      spendUsdCents: spendToday,
      emailsToLeads: emailsToday,
      cumulativeSpendUsdCents: cumSpend,
      cumulativeEmailsToLeads: cumEmails,
      priceUsdCents: pricePerEmail(cumSpend, cumEmails),
      cumulativePaidUsdCents: cumPaid,
      grossPriceUsdCents: pricePerEmail(cumPaid, cumEmails),
      monthToDateSpendUsdCents: mtdSpend,
      monthToDateEmailsToLeads: mtdEmails,
      monthPriceUsdCents: pricePerEmail(mtdSpend, mtdEmails),
    });
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
  /** The since-inception price at the month's last day in the series (month end, or today). */
  priceUsdCents: number | null;
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
    cumulativePaidUsdCents: p.cumulativePaidUsdCents,
    grossPriceUsdCents: p.grossPriceUsdCents,
  }));
}
