/**
 * What PERIOD each email-infrastructure payment covers, so the email send price can follow what
 * sending costs us NOW (owner 2026-11-23, EMAIL-PRICE-CURRENT-1123, replaces the 2026-10-01
 * since-inception rule): a payment loads only the emails sent while what it bought was running,
 * spread evenly over that period. Money paid for a period that is over is sunk and loads nothing.
 *
 * The bank ledger states WHEN and HOW MUCH, never what a line bought, so the term is declared here,
 * owner-reviewable, one line of evidence each:
 *
 *   - `EMAIL_INFRA_TERMS`: the vendor's billing rhythm, applied to every line of that vendor.
 *   - `EMAIL_INFRA_LINE_TERMS`: a line that is NOT the vendor's rhythm (a registrar transfer on a
 *     monthly account, a final month whose sends moved elsewhere), matched on vendor + booked day.
 *
 * Fail loud, like the VAT rule: a vendor with no declared term, or a line override that matches no
 * bank line although the ledger holds that vendor's lines past its day (a typo, a line the ledger
 * re-dated), throws `UncoveredSpendError` and the refresh keeps the previous series served, stale.
 * Never a guessed term.
 */

import type { SpendLine } from "./email-send-price.js";

export class UncoveredSpendError extends Error {}

export type Term = { months: number; why: string };

/** Billing rhythm per ledger vendor key (`EMAIL_INFRA_VENDORS`). */
export const EMAIL_INFRA_TERMS: Readonly<Record<string, Term>> = {
  instantly: {
    months: 1,
    why: "Instantly plans renew monthly on our cards (Hypergrowth 07-13, 08-16, 09-13; Growth 06-30, 07-30). Last charge 2026-09-16, subscriptions cut.",
  },
  forge: {
    months: 1,
    why: "Mailforge and Primeforge bill mailbox plans monthly (Primeforge 10-mailbox base plan, Chargebee monthly). The sending domains' registration is the Cloudflare transfer of 2026-11-20, not loaded twice.",
  },
  "gandi order": {
    months: 12,
    why: "Gandi orders are sending-domain registrations or renewals, one year each.",
  },
  cloudflare: {
    months: 1,
    why: "Cloudflare account bill, monthly (2026-09-27, 2026-10-27).",
  },
};

export type LineTerm = {
  vendor: string;
  bookedOn: string;
  /** Either a term in months from the booked day, or the first day the line no longer covers. */
  months?: number;
  coversUntil?: string;
  why: string;
};

/** Lines that are not their vendor's rhythm. Each must match at least one bank line. */
export const EMAIL_INFRA_LINE_TERMS: readonly LineTerm[] = [
  {
    vendor: "cloudflare",
    bookedOn: "2026-11-20",
    months: 12,
    why: "Transfer of 12 Primeforge sending domains to Cloudflare Registrar (PF-CLOUDFLARE-1120, 12 x $11.17): a transfer adds one year of registration at cost.",
  },
  {
    vendor: "forge",
    bookedOn: "2026-11-03",
    coversUntil: "2026-11-20",
    why: "Last month of Primeforge mailboxes: plan cut, no December charge. The Primeforge domains moved off the Google mailboxes to Amazon SES on 2026-11-20 (PF-CLOUDFLARE-1120), so this month loads only the emails sent before.",
  },
];

export type CoveredLine = {
  id: string;
  vendor: string;
  bookedOn: string;
  /** Excluding VAT, signed: a refund is negative. */
  netUsdCents: number;
  coversFrom: string;
  /** First day NOT covered (exclusive). */
  coversUntil: string;
  basis: string;
};

/** `day` + n calendar months, day-of-month clamped (01-31 + 1 month = 02-28). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(from: string, until: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Every line with the period it covers. Throws on a vendor with no term, an override matching no
 * line, or a declared period that is empty.
 */
export function coverLines(
  lines: SpendLine[],
  terms: Readonly<Record<string, Term>> = EMAIL_INFRA_TERMS,
  lineTerms: readonly LineTerm[] = EMAIL_INFRA_LINE_TERMS,
): CoveredLine[] {
  const noTerm = [...new Set(lines.map((l) => l.vendor).filter((v) => !terms[v]))];
  if (noTerm.length > 0) {
    throw new UncoveredSpendError(
      `No covered period is declared for email-infrastructure vendor(s) ${noTerm.join(", ")} (EMAIL_INFRA_TERMS): their payments cannot be spread, so the current email price is not computed`,
    );
  }
  // An override is owed a line once the ledger holds that vendor's lines up to its day: a line the
  // ledger re-dated or dropped then throws instead of silently taking the vendor's rhythm. (A ledger
  // read that stops earlier, e.g. a fixture, owes nothing yet.)
  const unmatched = lineTerms.filter(
    (o) =>
      lines.some((l) => l.vendor === o.vendor && l.bookedOn >= o.bookedOn) &&
      !lines.some((l) => l.vendor === o.vendor && l.bookedOn === o.bookedOn),
  );
  if (unmatched.length > 0) {
    throw new UncoveredSpendError(
      `Declared line term(s) match no bank line: ${unmatched.map((o) => `${o.vendor} ${o.bookedOn}`).join(", ")} (EMAIL_INFRA_LINE_TERMS)`,
    );
  }
  return lines
    .map((l) => {
      const override = lineTerms.find((o) => o.vendor === l.vendor && o.bookedOn === l.bookedOn);
      const term = terms[l.vendor];
      const coversUntil = override?.coversUntil ?? addMonths(l.bookedOn, override?.months ?? term.months);
      if (coversUntil <= l.bookedOn) {
        throw new UncoveredSpendError(`Line ${l.vendor} ${l.bookedOn} ${l.id} covers an empty period (until ${coversUntil})`);
      }
      const cents = Math.round(Math.abs(l.vat.excludingVat!.usdAmount) * 100);
      const basis = override
        ? override.coversUntil
          ? `until ${override.coversUntil}: ${override.why}`
          : `${override.months} month(s): ${override.why}`
        : `${term.months} month(s): ${term.why}`;
      return {
        id: l.id,
        vendor: l.vendor,
        bookedOn: l.bookedOn,
        netUsdCents: l.direction === "payment" ? cents : -cents,
        coversFrom: l.bookedOn,
        coversUntil,
        basis,
      };
    })
    .sort((a, b) => a.bookedOn.localeCompare(b.bookedOn) || a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id));
}

/** What a line costs per covered day, US cents (signed). */
export function perDayUsdCents(line: CoveredLine): number {
  return line.netUsdCents / daysBetween(line.coversFrom, line.coversUntil);
}

/** Lines whose period covers `day`. */
export function linesCovering(lines: CoveredLine[], day: string): CoveredLine[] {
  return lines.filter((l) => l.coversFrom <= day && day < l.coversUntil);
}
