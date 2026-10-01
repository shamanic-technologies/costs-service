import { describe, it, expect } from "vitest";
import { declaredVat, UNKNOWN_VAT } from "../helpers/ledger-vat.js";
import {
  emailsPerDay,
  monthlyRollup,
  priceSeries,
  pricePerEmail,
  spendPerDayAndVendor,
  type SpendLine,
  vatTakenOut,
  UnknownVatError,
} from "../../src/lib/email-send-price.js";
import { EMAIL_INFRA_VENDORS, EXCLUDED_EMAIL_VENDORS } from "../../src/lib/email-infra-vendors.js";

const pay = (vendor: string, bookedOn: string, usdAmount: number, direction: "payment" | "refund" = "payment", vatRate = 0): SpendLine => ({
  id: `${vendor}:${bookedOn}:${usdAmount}`,
  vendor,
  bookedOn,
  usdAmount,
  direction,
  vat: declaredVat(usdAmount, vatRate),
});

describe("email send price — owner formula: infra spend since inception / emails to leads since inception", () => {
  it("declares exactly the owner's email-infrastructure vendors, Google Workspace excluded", () => {
    expect(EMAIL_INFRA_VENDORS.map((v) => v.key)).toEqual(["instantly", "forge", "gandi order", "cloudflare"]);
    expect(EXCLUDED_EMAIL_VENDORS.map((v) => v.key)).toContain("google workspace");
    for (const v of EXCLUDED_EMAIL_VENDORS) expect(EMAIL_INFRA_VENDORS.map((i) => i.key)).not.toContain(v.key);
  });

  it("reproduces the 2026-10-01 production figure: ~$5,204 over 155,907 emails is ~3.34 US cents", () => {
    expect(pricePerEmail(520_400, 155_907)).toBeCloseTo(3.338, 3);
  });

  it("is null, never zero or infinite, over zero emails, and null over a negative net spend", () => {
    expect(pricePerEmail(10_000, 0)).toBeNull();
    expect(pricePerEmail(-1, 100)).toBeNull();
  });

  it("nets refunds per (day, vendor) in integer cents", () => {
    const silver = spendPerDayAndVendor([
      pay("instantly", "2026-03-01", 97.0),
      pay("instantly", "2026-03-01", 10.005),
      pay("instantly", "2026-03-01", 20, "refund"),
      pay("forge", "2026-03-01", 3.33),
    ]);
    const basis = "declared 0%: Bills excluding VAT (owner 2026-10-01)";
    expect(silver).toEqual([
      { day: "2026-03-01", vendor: "forge", paidUsdCents: 333, refundedUsdCents: 0, vatPaidUsdCents: 0, vatRefundedUsdCents: 0, vatBasis: basis, payments: 1, refunds: 0 },
      { day: "2026-03-01", vendor: "instantly", paidUsdCents: 10701, refundedUsdCents: 2000, vatPaidUsdCents: 0, vatRefundedUsdCents: 0, vatBasis: basis, payments: 2, refunds: 1 },
    ]);
  });

  it("counts each line EXCLUDING VAT, the VAT taken out beside it (owner 2026-10-01: VAT is recoverable)", () => {
    // Gandi bills 7.99 + 20% = 9.59; a 2.39 refund is 1.99 + 20%.
    const silver = spendPerDayAndVendor([pay("gandi order", "2026-03-01", 9.59, "payment", 0.2), pay("gandi order", "2026-03-01", 2.39, "refund", 0.2)]);
    expect(silver).toEqual([
      { day: "2026-03-01", vendor: "gandi order", paidUsdCents: 799, refundedUsdCents: 199, vatPaidUsdCents: 160, vatRefundedUsdCents: 40, vatBasis: "declared 20%: Every line is a price x 1.2", payments: 1, refunds: 1 },
    ]);
    expect(vatTakenOut(silver)).toEqual({ vatUsdCents: 120, vatBasis: "declared 20%: Every line is a price x 1.2" });
  });

  it("refuses a line whose VAT the ledger cannot state: never read as 0% or a guessed rate", () => {
    const line = { ...pay("forge", "2026-03-02", 50), vat: UNKNOWN_VAT };
    expect(() => spendPerDayAndVendor([pay("forge", "2026-03-01", 10), line])).toThrow(UnknownVatError);
    expect(() => spendPerDayAndVendor([line])).toThrow(/cannot state the VAT of 1 line\(s\).*forge 2026-03-02/);
  });

  it("is dense from the first PAYMENT (before any send) through today, price null until the first send", () => {
    const spend = spendPerDayAndVendor([pay("gandi order", "2026-01-30", 12)]);
    const emails = emailsPerDay([{ day: "2026-02-02", toLeads: 100 }, { day: "2026-02-01", toLeads: 0 }]);
    const series = priceSeries(spend, emails, "2026-02-03");
    expect(series.map((p) => p.day)).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02", "2026-02-03"]);
    expect(series[0].priceUsdCents).toBeNull();
    expect(series[3]).toMatchObject({ cumulativeSpendUsdCents: 1200, cumulativeEmailsToLeads: 100, priceUsdCents: 12 });
    // month-alone: February spent nothing, sent 100.
    expect(series[3]).toMatchObject({ monthToDateSpendUsdCents: 0, monthToDateEmailsToLeads: 100, monthPriceUsdCents: 0 });
    expect(series[4].day).toBe("2026-02-03");
    expect(series[4].priceUsdCents).toBe(12);
  });

  it("resets the month-alone figures on the 1st while the cumulative keeps running", () => {
    const spend = spendPerDayAndVendor([pay("instantly", "2026-05-31", 100), pay("instantly", "2026-06-01", 50)]);
    const emails = emailsPerDay([{ day: "2026-05-31", toLeads: 1000 }, { day: "2026-06-01", toLeads: 1000 }]);
    const [may31, jun1] = priceSeries(spend, emails, "2026-06-01");
    expect(may31).toMatchObject({ priceUsdCents: 10, monthPriceUsdCents: 10 });
    expect(jun1).toMatchObject({ cumulativeSpendUsdCents: 15000, priceUsdCents: 7.5, monthToDateSpendUsdCents: 5000, monthPriceUsdCents: 5 });
  });

  it("prices on NET consumed (owner: a refunded purchase was not consumed), gross carried beside", () => {
    const spend = spendPerDayAndVendor([pay("forge", "2026-05-01", 100), pay("forge", "2026-05-02", 40, "refund")]);
    const series = priceSeries(spend, emailsPerDay([{ day: "2026-05-01", toLeads: 1000 }]), "2026-05-02");
    expect(series[1]).toMatchObject({
      spendUsdCents: -4000,
      cumulativeSpendUsdCents: 6000,
      priceUsdCents: 6,
      cumulativePaidUsdCents: 10000,
      grossPriceUsdCents: 10,
    });
  });

  it("states no month-alone price for a month whose refunds exceed its payments", () => {
    const spend = spendPerDayAndVendor([pay("forge", "2026-05-01", 100), pay("forge", "2026-06-02", 40, "refund")]);
    const series = priceSeries(spend, emailsPerDay([{ day: "2026-06-01", toLeads: 1000 }]), "2026-06-02");
    expect(series[series.length - 1]).toMatchObject({ monthToDateSpendUsdCents: -4000, monthPriceUsdCents: null, priceUsdCents: 6 });
  });

  it("rolls up per month with per-vendor spend and both prices at the month's last point", () => {
    const spend = spendPerDayAndVendor([pay("instantly", "2026-05-10", 100), pay("forge", "2026-06-02", 30), pay("forge", "2026-06-03", 10, "refund")]);
    const emails = emailsPerDay([{ day: "2026-05-11", toLeads: 1000 }, { day: "2026-06-05", toLeads: 1000 }]);
    const series = priceSeries(spend, emails, "2026-06-10");
    const months = monthlyRollup(spend, series, ["instantly", "forge"]);
    expect(months).toEqual([
      {
        month: "2026-05",
        spendUsdCents: 10000,
        spendByVendorUsdCents: { instantly: 10000, forge: 0 },
        paidUsdCents: 10000,
        refundedUsdCents: 0,
        emailsToLeads: 1000,
        monthPriceUsdCents: 10,
        cumulativeSpendUsdCents: 10000,
        cumulativeEmailsToLeads: 1000,
        priceUsdCents: 10,
        cumulativePaidUsdCents: 10000,
        grossPriceUsdCents: 10,
      },
      {
        month: "2026-06",
        spendUsdCents: 2000,
        spendByVendorUsdCents: { instantly: 0, forge: 2000 },
        paidUsdCents: 3000,
        refundedUsdCents: 1000,
        emailsToLeads: 1000,
        monthPriceUsdCents: 2,
        cumulativeSpendUsdCents: 12000,
        cumulativeEmailsToLeads: 2000,
        priceUsdCents: 6,
        cumulativePaidUsdCents: 13000,
        grossPriceUsdCents: 6.5,
      },
    ]);
  });

  it("refuses a day reported twice by the send source rather than double counting it", () => {
    expect(() => emailsPerDay([{ day: "2026-05-01", toLeads: 1 }, { day: "2026-05-01", toLeads: 2 }])).toThrow(/twice/);
  });
});
