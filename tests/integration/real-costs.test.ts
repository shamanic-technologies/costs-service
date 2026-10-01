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
const PAYMENTS = { generatedAt: "2026-10-01T10:00:00.000Z", since: null, vendors: [], payments: [pay("anthropic", "2026-02-01", 3)] };

const money = (billed: string) => ({ billedCostInUsdCents: billed, netBilledCostInUsdCents: billed, refundedCostInUsdCents: "0.0000000000", netRefundedCostInUsdCents: "0.0000000000" });
const day = (extra: Record<string, unknown>) => ({ day: "2026-02-02", orgId: ORG, costName: "anthropic-tokens", costSource: "platform", quantity: "1000000.000000", refundedQuantity: "0.000000", ...money("500.0000000000"), ...extra });
const BY_ORG = { timezone: "UTC", since: null, statuses: ["actual", "refunded"], groupBy: ["orgId"], days: [day({}), day({ costName: "stripe-processing-fee", quantity: "30.000000", ...money("30.0000000000") })], totals: [] };
const BY_BRAND = { ...BY_ORG, groupBy: ["orgId", "brandId"], days: BY_ORG.days.map((d) => ({ ...d, brandId: "brand-1" })) };

function stub(over: Partial<Record<"vendors" | "payments" | "byOrg" | "byBrand", () => Response>> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://ledger.test/api/v1/vendors")) return (over.vendors ?? (() => json(LEDGER_VENDORS)))();
      if (url.startsWith("https://ledger.test/api/v1/vendor-payments")) return (over.payments ?? (() => json(PAYMENTS)))();
      if (url.includes("groupBy=orgId%2CbrandId")) return (over.byBrand ?? (() => json(BY_BRAND)))();
      if (url.includes("groupBy=orgId")) return (over.byOrg ?? (() => json(BY_ORG)))();
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

async function clean() {
  for (const t of [realUnitCostsDaily, paygRatioDaily, consumptionByOrgDaily, consumptionByBrandDaily, paygVendorSpendDaily, realCostRawReads, realCostRefreshes, emailSendPriceDaily, emailSendPriceRefreshes, subscriptionCostDaily, subscriptionCostRefreshes, providerCostVendorCosts]) {
    await db.delete(t);
  }
  await cleanTestData();
}

async function seedCatalogue() {
  for (const [name, provider, price, vendor, basis] of [
    ["anthropic-tokens", "anthropic", "0.0005000000", "0.0001000000", "marked-up"],
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
    await clean();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["LEDGER_API_URL", "LEDGER_API_KEY", "RUNS_SERVICE_URL", "RUNS_SERVICE_API_KEY"]) delete process.env[k];
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
    expect(same.body.totals).toMatchObject({ differenceUsdCents: 0, amount1UsdCents: 530, billedUsdCents: 530, billedPlatformKeyUsdCents: 530 });
    expect(same.body.byOrg[0].orgId).toBe(ORG);
    expect(same.body.byBrand[0]).toMatchObject({ orgId: ORG, brandId: "brand-1" });

    const vsProposed = await request(app).get(`/internal/price-comparison?list1=catalogue:${today}&list2=proposed:${today}&orgId=${ORG}&brandId=brand-1&interval=day`).set(API_KEY);
    expect(vsProposed.status).toBe(200);
    // anthropic 1,000,000 x 0.0006 = 600 + stripe 30 x 1 = 630; real on Feb 2 (paid Feb 1, ratio 3) 1,000,000 x 0.0003 = 300 + stripe 30
    expect(vsProposed.body.totals).toMatchObject({ amount2UsdCents: 630, differenceUsdCents: 100, realCostUsdCents: 330, margin2UsdCents: 300 });
    expect(vsProposed.body.perimeter).toEqual({ grain: "org-brand", orgId: ORG, brandId: "brand-1" });
    expect(vsProposed.body.byOrg).toBeNull();
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
