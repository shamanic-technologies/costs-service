import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, insertPlatformCost, insertTestProviderCost } from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import {
  consumptionByBrandDaily,
  consumptionByOrgDaily,
  emailSendPriceDaily,
  emailSendPriceRefreshes,
  paygRatioDaily,
  paygVendorPartsDaily,
  paygVendorSpendDaily,
  providerCostVendorCosts,
  realCostRawReads,
  realCostRefreshes,
  realUnitCostsDaily,
  subscriptionCostDaily,
  subscriptionCostRefreshes,
} from "../../src/db/schema.js";
import { refreshRealCosts } from "../../src/db/real-cost.js";
import { utcDay } from "../../src/db/email-send-price.js";

const API_KEY = { "x-api-key": "test-api-key" };
const T0 = new Date("2025-01-01T00:00:00Z");
const ORG = "11111111-1111-4111-8111-111111111111";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const LEDGER_VENDORS = {
  generatedAt: "2026-10-01T10:00:00.000Z",
  vendors: ["anthropic", "anthropic ireland", "google cloud abc", "deepseek", "openai", "moonshot ai", "moonshot ai pte", "twilio com", "treg"].map((key) => ({
    key,
    name: key,
    lastPaidOn: "2026-02-01",
    paidFrom: [],
  })),
};
const pay = (vendor: string, bookedOn: string, usdAmount: number) => ({ id: `${vendor}:${bookedOn}`, vendor, bookedOn, direction: "payment", amount: usdAmount, currency: "USD", eurAmount: usdAmount, usdAmount, accountId: "acc" });
const PAYMENTS = {
  generatedAt: "2026-10-01T10:00:00.000Z",
  since: null,
  vendors: [],
  payments: [pay("anthropic", "2026-02-01", 3), pay("twilio com", "2026-02-01", 20), pay("twilio com", "2026-02-01", 47.14), pay("google cloud abc", "2026-01-20", 100)],
};

// Google Cloud (bank ledger split, EUR): January has no export; February's export covers 02-02 only:
// Gemini 10, Secret Manager 1, tax 2, a 3 EUR prepaid top-up charged 02-02. Ledger rate 1.2 USD/EUR.
const GOOGLE_SPLIT = {
  generatedAt: "2026-10-01T10:00:00.000Z",
  vendor: "google cloud",
  currency: "EUR",
  since: "2026-01",
  until: "2026-02",
  months: [
    { month: "2026-01", export: null, bank: { payments: [{ eurAmount: 50, usdAmount: 60, direction: "payment" }], paidEur: 50, prepaidEur: 0 }, explainedEur: 0, unexplainedEur: 50, notes: [] },
    {
      month: "2026-02",
      export: {
        coveredFrom: "2026-02-02",
        coveredTo: "2026-02-02",
        partial: true,
        consumption: [{ service: "Gemini API", costEur: 10, creditsEur: 0, netEur: 10 }, { service: "Secret Manager", costEur: 1, creditsEur: 0, netEur: 1 }],
        consumptionEur: 11,
        taxEur: 2,
        adjustmentsEur: 0,
        roundingEur: 0,
        invoiceEur: 13,
        prepayments: [{ chargedOn: "2026-02-02", creditEur: 3, taxEur: 0, totalEur: 3, bankPaymentIds: [] }],
        prepaidEur: 3,
      },
      bank: { payments: [], paidEur: 0, prepaidEur: 0 },
      explainedEur: 16,
      unexplainedEur: -16,
      notes: [],
    },
  ],
  totals: {},
};

// Twilio (prepaid): 2026-02-02 one call priced $0.03 and the number rented $1.15; $16.67 left on the balance.
const TWILIO_DAILY: Record<string, { start_date: string; price: string }[]> = {
  calls: [{ start_date: "2026-02-02", price: "0.03" }],
  sms: [],
  mms: [],
  channels: [{ start_date: "2026-02-02", price: "0.002" }],
  phonenumbers: [{ start_date: "2026-02-02", price: "1.15" }],
  totalprice: [{ start_date: "2026-02-02", price: "1.182" }],
};
const twilioPage = (url: string) => {
  const category = new URL(url).searchParams.get("Category")!;
  return json({ usage_records: (TWILIO_DAILY[category] ?? []).map((r) => ({ category, price_unit: "usd", ...r })), next_page_uri: null });
};

const money = (billed: string) => ({ billedCostInUsdCents: billed, netBilledCostInUsdCents: billed, refundedCostInUsdCents: "0.0000000000", netRefundedCostInUsdCents: "0.0000000000" });
const day = (extra: Record<string, unknown>) => ({ day: "2026-02-02", orgId: ORG, costName: "anthropic-tokens", costSource: "platform", quantity: "1000000.000000", refundedQuantity: "0.000000", ...money("500.0000000000"), ...extra });
const BY_ORG = {
  timezone: "UTC",
  since: null,
  statuses: ["actual", "refunded"],
  groupBy: ["orgId"],
  days: [day({}), day({ costName: "stripe-processing-fee", quantity: "30.000000", ...money("30.0000000000") }), day({ costName: "twilio-voice-minute", quantity: "2.000000", ...money("20.0000000000") })],
  totals: [],
};
const BY_BRAND = { ...BY_ORG, groupBy: ["orgId", "brandId"], days: BY_ORG.days.map((d) => ({ ...d, brandId: "brand-1" })) };

function stub(over: Partial<Record<"vendors" | "payments" | "byOrg" | "byBrand" | "twilio" | "google", () => Response>> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://ledger.test/api/v1/vendors")) return (over.vendors ?? (() => json(LEDGER_VENDORS)))();
      if (url === "https://ledger.test/api/v1/vendor-payments/google-cloud?since=2026-01") return (over.google ?? (() => json(GOOGLE_SPLIT)))();
      if (url.startsWith("https://ledger.test/api/v1/vendor-payments")) return (over.payments ?? (() => json(PAYMENTS)))();
      if (url === "http://keys.test/keys/platform/twilio/decrypt") return json({ provider: "twilio", key: JSON.stringify({ accountSid: "AC1", authToken: "t" }) });
      if (url.startsWith("https://api.twilio.com/2010-04-01/Accounts/AC1/Usage/Records/Daily.json")) return (over.twilio ?? (() => twilioPage(url)))();
      if (url === "https://api.twilio.com/2010-04-01/Accounts/AC1/Balance.json") return json({ account_sid: "AC1", balance: "16.67", currency: "USD" });
      if (url.includes("groupBy=orgId%2CbrandId")) return (over.byBrand ?? (() => json(BY_BRAND)))();
      if (url.includes("groupBy=orgId")) return (over.byOrg ?? (() => json(BY_ORG)))();
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

async function clean() {
  for (const t of [realUnitCostsDaily, paygRatioDaily, paygVendorPartsDaily, consumptionByOrgDaily, consumptionByBrandDaily, paygVendorSpendDaily, realCostRawReads, realCostRefreshes, emailSendPriceDaily, emailSendPriceRefreshes, subscriptionCostDaily, subscriptionCostRefreshes, providerCostVendorCosts]) {
    await db.delete(t);
  }
  await cleanTestData();
}

async function seedCatalogue() {
  for (const [name, provider, price, vendor, basis] of [
    ["anthropic-tokens", "anthropic", "0.0005000000", "0.0001000000", "marked-up"],
    ["twilio-voice-minute", "twilio", "10.0000000000", "2.0000000000", "marked-up"],
    ["google-tokens", "google", "10.0000000000", "2.0000000000", "marked-up"],
    ["stripe-processing-fee", "stripe", "1.0000000000", "1.0000000000", "pass-through"],
  ] as const) {
    await insertPlatformCost({ provider, planTier: "p", billingCycle: "monthly", effectiveFrom: T0 });
    const row = await insertTestProviderCost({ name, provider, planTier: "p", billingCycle: "monthly", costPerUnitInUsdCents: price, pricingBasis: basis, effectiveFrom: T0 });
    await db.insert(providerCostVendorCosts).values({ providerCostId: row.id, vendorCostPerUnitInUsdCents: vendor, markupMultiplier: "5.0000", derivation: "seed" });
  }
  const today = utcDay(new Date());
  await db.insert(emailSendPriceRefreshes).values({ asOf: today, status: "succeeded", finishedAt: new Date() });
  await db.insert(subscriptionCostRefreshes).values({ asOf: today, status: "succeeded", finishedAt: new Date() });
}

describe("real costs, proposed price list, price list at a date, comparison", () => {
  const app = createTestApp();

  beforeEach(async () => {
    process.env.LEDGER_API_URL = "https://ledger.test";
    process.env.LEDGER_API_KEY = "kla_test";
    process.env.RUNS_SERVICE_URL = "http://runs.test";
    process.env.RUNS_SERVICE_API_KEY = "runs_test";
    process.env.KEY_SERVICE_URL = "http://keys.test";
    process.env.KEY_SERVICE_API_KEY = "keys_test";
    await clean();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["LEDGER_API_URL", "LEDGER_API_KEY", "RUNS_SERVICE_URL", "RUNS_SERVICE_API_KEY", "KEY_SERVICE_URL", "KEY_SERVICE_API_KEY"]) delete process.env[k];
  });

  afterAll(clean);

  it("refuses a caller without the service api key", async () => {
    for (const path of ["/internal/real-costs", "/internal/price-lists?source=catalogue&date=2026-10-01", "/internal/price-comparison"]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).post("/internal/real-costs/refresh")).status).toBe(401);
  });

  it("answers 503 before the first refresh, and fails loud while a sibling gold was never computed", async () => {
    expect((await request(app).get("/internal/real-costs").set(API_KEY)).status).toBe(503);
    stub();
    const res = await request(app).post("/internal/real-costs/refresh").set(API_KEY);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/email send price has never been computed/);
  });

  it("computes real cost x2 for a production item and x1 for Stripe, dated today, idempotently", async () => {
    await seedCatalogue();
    stub();
    const today = utcDay(new Date());
    const refresh = await request(app).post("/internal/real-costs/refresh").set(API_KEY);
    expect(refresh.status).toBe(200);
    expect(refresh.body.asOf).toBe(today);

    const res = await request(app).get("/internal/real-costs").set(API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ day: today, asOf: today, stale: false });
    const anthropic = res.body.items.find((i: { costName: string }) => i.costName === "anthropic-tokens");
    // recorded 1,000,000 x 0.0001 = 100 cents; paid 300 cents -> ratio 3 -> real 0.0003 -> proposed 0.0006
    expect(anthropic).toMatchObject({ method: "pay-as-you-go-ratio", ratio: 3, realCostPerUnitUsdCents: 0.0003, proposedPricePerUnitUsdCents: 0.0006, proposedBasis: "real-cost-x2" });
    const stripe = res.body.items.find((i: { costName: string }) => i.costName === "stripe-processing-fee");
    expect(stripe).toMatchObject({ method: "pass-through", multiplier: 1, proposedPricePerUnitUsdCents: 1, proposedBasis: "real-cost-x1" });
    expect(res.body.payAsYouGo.find((p: { provider: string }) => p.provider === "anthropic")).toMatchObject({ netPaidUsdCents: 300, vendorCostRecordedUsdCents: 100, ratio: 3 });

    const before = await db.select().from(realUnitCostsDaily);
    await refreshRealCosts();
    const after = await db.select().from(realUnitCostsDaily);
    expect(after.map(({ refreshId: _r, ...x }) => x)).toEqual(before.map(({ refreshId: _r, ...x }) => x));

    const series = await request(app).get("/internal/real-costs/anthropic-tokens").set(API_KEY);
    expect(series.body.daily[0].day).toBe("2026-01-01");
    expect(series.body.daily.at(-1).day).toBe(today);
  });

  it("serves a price list at a date and a fleet comparison: catalogue vs itself is zero, billed is runs-service's", async () => {
    await seedCatalogue();
    stub();
    await refreshRealCosts();
    const today = utcDay(new Date());

    const list = await request(app).get(`/internal/price-lists?source=proposed&date=${today}`).set(API_KEY);
    expect(list.status).toBe(200);
    expect(list.body.items.find((i: { costName: string }) => i.costName === "anthropic-tokens").pricePerUnitUsdCents).toBe(0.0006);
    expect((await request(app).get("/internal/price-lists?source=proposed&date=2025-06-01").set(API_KEY)).status).toBe(404);
    expect((await request(app).get("/internal/price-lists?source=nope&date=2026-01-01").set(API_KEY)).status).toBe(400);

    const same = await request(app).get(`/internal/price-comparison?list1=catalogue:${today}&list2=catalogue:${today}`).set(API_KEY);
    expect(same.status).toBe(200);
    expect(same.body.totals).toMatchObject({ differenceUsdCents: 0, amount1UsdCents: 550, billedUsdCents: 550, billedPlatformKeyUsdCents: 550 });
    expect(same.body.byOrg[0].orgId).toBe(ORG);
    expect(same.body.byBrand[0]).toMatchObject({ orgId: ORG, brandId: "brand-1" });

    const vsProposed = await request(app).get(`/internal/price-comparison?list1=catalogue:${today}&list2=proposed:${today}&orgId=${ORG}&brandId=brand-1&interval=day`).set(API_KEY);
    expect(vsProposed.status).toBe(200);
    // anthropic 1,000,000 x 0.0006 = 600 + stripe 30 x 1 = 630 + twilio 2 x 3.2 = 636.4 (catalogue 550);
    // real on Feb 2 (anthropic paid Feb 1, ratio 3) 1,000,000 x 0.0003 = 300 + stripe 30 + twilio 2 x 1.6 = 333.2
    expect(vsProposed.body.totals).toMatchObject({ amount2UsdCents: 636.4, differenceUsdCents: 86.4, realCostUsdCents: 333.2, margin2UsdCents: 303.2 });
    expect(vsProposed.body.perimeter).toEqual({ grain: "org-brand", orgId: ORG, brandId: "brand-1" });
    expect(vsProposed.body.byOrg).toBeNull();
  });

  it("Twilio: per-minute real cost uses what Twilio priced the minutes at, the rental, balance and unexplained bank money served apart (x21.4 bug)", async () => {
    await seedCatalogue();
    stub();
    await refreshRealCosts();
    const res = await request(app).get("/internal/real-costs").set(API_KEY);
    const tw = res.body.payAsYouGo.find((p: { provider: string }) => p.provider === "twilio");
    // recorded 2 minutes x 2 cents = 4 cents; Twilio priced calls + channels 3.2 cents -> ratio 0.8 (not 6714 / 4)
    expect(tw).toMatchObject({ netPaidUsdCents: 6714, numeratorBasis: "twilio-usage-metered", meteredUsdCents: 3.2, vendorCostRecordedUsdCents: 4, ratio: 0.8 });
    const part = (name: string) => tw.split.parts.find((p: { part: string }) => p.part === name);
    expect(part("metered")).toMatchObject({ usdCents: 3.2, loadedOnUnits: true, flag: null });
    expect(part("rental")).toMatchObject({ usdCents: 115, loadedOnUnits: false, flag: "subscription-not-loaded-on-units" });
    expect(part("other").usdCents).toBe(0);
    expect(part("unconsumed-balance")).toMatchObject({ usdCents: 1667, flag: "prepaid-not-consumed" });
    // 6714 paid - 118.2 consumed - 1667 left = 4928.8 the vendor cannot explain (an earlier account)
    expect(tw.split.unexplained).toMatchObject({ usdCents: 4928.8, loadedOnUnits: false, flag: "unexplained-not-loaded-on-units" });
    const minute = res.body.items.find((i: { costName: string }) => i.costName === "twilio-voice-minute");
    expect(minute).toMatchObject({ method: "pay-as-you-go-ratio", ratio: 0.8, realCostPerUnitUsdCents: 1.6, proposedPricePerUnitUsdCents: 3.2 });
    // A ledger-only vendor carries no split.
    expect(res.body.payAsYouGo.find((p: { provider: string }) => p.provider === "anthropic").split).toBeNull();
  });

  it("Google: Gemini's real cost uses only Gemini consumption from the export's first day; tax, other services, prepaid and pre-export money apart (x3.24 bug)", async () => {
    await seedCatalogue();
    // 1000 units on 01-15 (before the export) must not dilute the ratio; 300 units on 02-02 = 600 cents recorded.
    const g = (d: string, q: string) => day({ day: d, costName: "google-tokens", quantity: q, ...money("0.0000000000") });
    stub({ byOrg: () => json({ ...BY_ORG, days: [...BY_ORG.days, g("2026-01-15", "1000.000000"), g("2026-02-02", "300.000000")] }) });
    await refreshRealCosts();
    const res = await request(app).get("/internal/real-costs").set(API_KEY);
    const gc = res.body.payAsYouGo.find((p: { provider: string }) => p.provider === "google");
    // Gemini 10 EUR x 1.2 = 1200 cents over 600 recorded from 02-02 -> ratio 2 (the whole bank block would say 10000 / 2600)
    expect(gc).toMatchObject({ netPaidUsdCents: 10000, numeratorBasis: "google-cloud-split-metered", meteredUsdCents: 1200, vendorCostRecordedUsdCents: 600, ratio: 2 });
    const part = (name: string) => gc.split.parts.find((p: { part: string }) => p.part === name);
    expect(part("metered")).toMatchObject({ usdCents: 1200, loadedOnUnits: true });
    expect(part("other-services")).toMatchObject({ usdCents: 120, loadedOnUnits: false, flag: "other-services-not-loaded-on-units" });
    expect(part("tax")).toMatchObject({ usdCents: 240, loadedOnUnits: false, flag: "tax-not-real-cost" });
    expect(part("adjustments").usdCents).toBe(0);
    expect(part("prepaid")).toMatchObject({ usdCents: 360, loadedOnUnits: false });
    expect(part("metered").basis).toMatch(/EUR->USD 1\.2000/);
    expect(gc.split.unexplained).toMatchObject({ usdCents: 8080, flag: "unexplained-not-loaded-on-units" });
    expect(res.body.items.find((i: { costName: string }) => i.costName === "google-tokens")).toMatchObject({ ratio: 2, realCostPerUnitUsdCents: 4, proposedPricePerUnitUsdCents: 8 });
    // Before the export covers a day, the item keeps its catalogue vendor cost, flagged.
    const jan = await request(app).get("/internal/real-costs?day=2026-01-31").set(API_KEY);
    expect(jan.body.items.find((i: { costName: string }) => i.costName === "google-tokens")).toMatchObject({ method: "catalogue-vendor-cost", flag: "no-metered-spend-yet", realCostPerUnitUsdCents: 2 });
    expect(jan.body.payAsYouGo.find((p: { provider: string }) => p.provider === "google").split.unexplained.usdCents).toBe(10000);
  });

  it("fails loud when the Google Cloud split cannot be read", async () => {
    await seedCatalogue();
    stub({ google: () => json({ error: "boom" }, 500) });
    const res = await request(app).post("/internal/real-costs/refresh").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/google-cloud/);
  });

  it("fails loud when Twilio cannot answer", async () => {
    await seedCatalogue();
    stub({ twilio: () => json({ message: "Authenticate" }, 401) });
    const res = await request(app).post("/internal/real-costs/refresh").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Twilio refused/);
  });

  it("fails loud when runs-service cannot answer and keeps the last series served", async () => {
    await seedCatalogue();
    stub();
    await refreshRealCosts();
    stub({ byBrand: () => json({ error: "boom" }, 500) });
    const failed = await request(app).post("/internal/real-costs/refresh").set(API_KEY);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/runs-service refused/);
    const res = await request(app).get("/internal/real-costs").set(API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.lastRefresh).toMatchObject({ status: "failed" });
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("fails loud when a declared ledger vendor was never paid", async () => {
    await seedCatalogue();
    stub({ vendors: () => json({ ...LEDGER_VENDORS, vendors: LEDGER_VENDORS.vendors.filter((v) => v.key !== "treg") }) });
    const res = await request(app).post("/internal/real-costs/refresh").set(API_KEY);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/never paid declared vendor "treg"/);
  });
});
