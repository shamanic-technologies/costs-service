import { describe, it, expect } from "vitest";
import { declaredVat } from "../helpers/ledger-vat.js";
import {
  addMonths,
  coverLines,
  daysBetween,
  EMAIL_INFRA_LINE_TERMS,
  EMAIL_INFRA_TERMS,
  linesCovering,
  perDayUsdCents,
  UncoveredSpendError,
  type Term,
} from "../../src/lib/email-infra-coverage.js";
import { EMAIL_INFRA_VENDORS } from "../../src/lib/email-infra-vendors.js";
import { addDays, currentPricePerEmail, emailsPerDay, priceSeries, spendPerDayAndVendor, type SpendLine } from "../../src/lib/email-send-price.js";

const pay = (vendor: string, bookedOn: string, usdAmount: number, direction: "payment" | "refund" = "payment"): SpendLine => ({
  id: `${vendor}:${bookedOn}:${usdAmount}:${direction}`,
  vendor,
  bookedOn,
  usdAmount,
  direction,
  vat: declaredVat(usdAmount, 0),
});

const TERMS: Record<string, Term> = {
  domains: { months: 12, why: "a domain registration covers a year" },
  plan: { months: 1, why: "a monthly plan covers its month" },
};

/** A steady 1,000 emails to leads every day of [from, until). */
const steadySends = (from: string, until: string) => {
  const days = [];
  for (let d = from; d < until; d = addDays(d, 1)) days.push({ day: d, toLeads: 1000 });
  return emailsPerDay(days);
};

const seriesFor = (lines: SpendLine[], sends: { day: string; toLeads: number }[], today: string) =>
  priceSeries(spendPerDayAndVendor(lines), sends, coverLines(lines, TERMS, []), today);

describe("email price follows the CURRENT running cost (EMAIL-PRICE-CURRENT-1123)", () => {
  it("adds calendar months, clamping the day of month", () => {
    expect(addMonths("2026-11-20", 12)).toBe("2027-11-20");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-27", 1)).toBe("2026-11-27");
  });

  it("loads a 12-month domain payment at 1/12 per month: the whole amount over its year, nothing after", () => {
    // $365 for a year from 2026-01-01: one dollar a day.
    const [line] = coverLines([pay("domains", "2026-01-01", 365)], TERMS, []);
    expect(line).toMatchObject({ coversFrom: "2026-01-01", coversUntil: "2027-01-01" });
    expect(daysBetween(line.coversFrom, line.coversUntil)).toBe(365);
    expect(perDayUsdCents(line)).toBe(100);

    const sends = steadySends("2025-12-01", "2027-02-01");
    const series = seriesFor([pay("domains", "2026-01-01", 365)], sends, "2027-01-31");
    const loadedInApril = series.filter((p) => p.day.startsWith("2026-04")).reduce((t, p) => t + p.runningCostUsdCentsPerDay, 0);
    expect(loadedInApril).toBeCloseTo((36_500 * 30) / 365, 6); // ~1/12 of the year
    const loadedOverYear = series.filter((p) => p.day.startsWith("2026")).reduce((t, p) => t + p.runningCostUsdCentsPerDay, 0);
    expect(loadedOverYear).toBeCloseTo(36_500, 6);
    // 100 cents a day over 1,000 emails a day = 0.1 cent per email, all year.
    expect(series.find((p) => p.day === "2026-06-15")!.priceUsdCents).toBe(0.1);
    // The year is over: sunk, never re-billed.
    expect(series.find((p) => p.day === "2027-01-15")!.priceUsdCents).toBe(0);
  });

  it("stops loading a monthly plan once its month is over", () => {
    const sends = steadySends("2026-05-01", "2026-08-01");
    const series = seriesFor([pay("plan", "2026-06-01", 300)], sends, "2026-07-31");
    const at = (d: string) => series.find((p) => p.day === d)!;
    expect(at("2026-06-15").runningCostUsdCentsPerDay).toBe(1000); // $300 over June's 30 days
    expect(at("2026-06-15").priceUsdCents).toBe(1);
    expect(at("2026-06-30").priceUsdCents).toBe(1);
    expect(at("2026-07-01")).toMatchObject({ runningCostUsdCentsPerDay: 0, priceUsdCents: 0 });
    // The superseded average still carries the $300 on every later email: served beside, labelled.
    expect(at("2026-07-31").sinceInceptionPriceUsdCents).toBeGreaterThan(0);
  });

  it("is 0 (not null, not the old average) when no payment covers the day, null only over zero emails", () => {
    const sends = steadySends("2026-03-01", "2026-04-01");
    const series = seriesFor([pay("plan", "2026-01-01", 500)], sends, "2026-03-31");
    const last = series[series.length - 1];
    expect(last.priceUsdCents).toBe(0);
    expect(last.sinceInceptionPriceUsdCents).not.toBe(0);
    // Nothing sent in the 30 days before: no price at all.
    const quiet = seriesFor([pay("plan", "2026-03-01", 500)], [], "2026-03-10");
    expect(quiet[quiet.length - 1].priceUsdCents).toBeNull();
    expect(currentPricePerEmail(0, 0)).toBeNull();
    expect(currentPricePerEmail(0, 10)).toBe(0);
  });

  it("divides by the emails per day of the 30 full days BEFORE the day, today's partial sends left out", () => {
    const sends = emailsPerDay([...steadySends("2026-05-01", "2026-05-31"), { day: "2026-05-31", toLeads: 7 }]);
    const series = seriesFor([pay("domains", "2026-01-01", 365)], sends, "2026-05-31");
    const may31 = series.find((p) => p.day === "2026-05-31")!;
    expect(may31.trailingEmailsPerDay).toBe(1000);
    expect(may31.priceUsdCents).toBe(0.1);
  });

  it("spreads a refund negative over its own term (net consumed)", () => {
    const lines = [pay("plan", "2026-06-01", 300), pay("plan", "2026-06-01", 300, "refund")];
    const series = seriesFor(lines, steadySends("2026-05-01", "2026-06-20"), "2026-06-15");
    expect(series.find((p) => p.day === "2026-06-15")).toMatchObject({ runningCostUsdCentsPerDay: 0, priceUsdCents: 0 });
  });

  it("fails loud on a vendor with no declared term, never a guessed one", () => {
    expect(() => coverLines([pay("mystery", "2026-06-01", 10)], TERMS, [])).toThrow(UncoveredSpendError);
    expect(() => coverLines([pay("mystery", "2026-06-01", 10)], TERMS, [])).toThrow(/mystery/);
  });

  it("fails loud on a line override that matches no bank line once the ledger holds lines past its day (typo or re-dated line)", () => {
    const stale = [{ vendor: "plan", bookedOn: "2026-06-02", months: 12, why: "x" }];
    expect(() => coverLines([pay("plan", "2026-06-03", 10)], TERMS, stale)).toThrow(/match no bank line: plan 2026-06-02/);
    // A ledger read that stops before the override's day owes it nothing yet.
    expect(coverLines([pay("plan", "2026-06-01", 10)], TERMS, stale)).toHaveLength(1);
  });

  it("applies a line override: a different term, or an end date when what it paid stopped carrying sends", () => {
    const lines = [pay("plan", "2026-11-03", 387), pay("plan", "2026-11-20", 134.04)];
    const covered = coverLines(lines, TERMS, [
      { vendor: "plan", bookedOn: "2026-11-03", coversUntil: "2026-11-20", why: "last month, sends moved away" },
      { vendor: "plan", bookedOn: "2026-11-20", months: 12, why: "registrar transfer, one year" },
    ]);
    expect(covered.map((l) => [l.bookedOn, l.coversUntil])).toEqual([
      ["2026-11-03", "2026-11-20"],
      ["2026-11-20", "2027-11-20"],
    ]);
    expect(linesCovering(covered, "2026-11-23").map((l) => l.bookedOn)).toEqual(["2026-11-20"]);
  });

  it("declares a term for every email-infrastructure vendor", () => {
    for (const v of EMAIL_INFRA_VENDORS) expect(EMAIL_INFRA_TERMS[v.key], v.key).toBeDefined();
    for (const o of EMAIL_INFRA_LINE_TERMS) expect(EMAIL_INFRA_TERMS[o.vendor], o.vendor).toBeDefined();
  });

  it("prices 2026-11-23 from the real November lines: the Cloudflare transfer + Gandi domains, Primeforge's last month spent", () => {
    // The bank lines that can still cover 2026-11-23 (prod ledger read 2026-11-23), excluding VAT.
    const lines: SpendLine[] = [
      pay("gandi order", "2026-06-03", 75.48),
      pay("gandi order", "2026-09-24", 5.67),
      pay("cloudflare", "2026-10-27", 1.65),
      pay("forge", "2026-11-03", 387),
      ...Array.from({ length: 12 }, (_, i) => ({ ...pay("cloudflare", "2026-11-20", 11.17), id: `cf-transfer-${i}` })),
    ];
    const covered = coverLines(lines);
    const today = linesCovering(covered, "2026-11-23");
    expect(today.map((l) => l.vendor)).not.toContain("forge");
    const perDay = today.reduce((t, l) => t + perDayUsdCents(l), 0);
    // 134.04/365 + 81.15/365 + 1.65/31 dollars a day ~ 64.3 cents.
    expect(perDay).toBeCloseTo(13_404 / 365 + 8_115 / 365 + 165 / 31, 6);
    // At ~900 emails a day: well under the old 2.69 cents, in the owner's 0.06-0.2 cent range.
    expect(currentPricePerEmail(perDay, 900)).toBeGreaterThan(0.06);
    expect(currentPricePerEmail(perDay, 900)).toBeLessThan(0.2);
  });
});
