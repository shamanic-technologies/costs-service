import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { declaredVat } from "../helpers/ledger-vat.js";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { db } from "../../src/db/index.js";
import {
  subscriptionConsumptionDaily,
  subscriptionCostDaily,
  subscriptionCostRawReads,
  subscriptionCostRefreshes,
  subscriptionSpendDaily,
} from "../../src/db/schema.js";
import { refreshSubscriptionCosts, readStoredSubscriptionCosts } from "../../src/db/subscription-cost.js";
import { utcDay } from "../../src/db/email-send-price.js";

const API_KEY = { "x-api-key": "test-api-key" };

function payment(vendor: string, bookedOn: string, usdAmount: number, direction: "payment" | "refund" = "payment") {
  return { id: `acc:${vendor}:${bookedOn}:${usdAmount}`, vendor, bookedOn, direction, amount: usdAmount, currency: "USD", eurAmount: usdAmount * 0.9, usdAmount, accountId: "acc", vat: declaredVat(usdAmount, 0, usdAmount * 0.9) };
}

const LEDGER = {
  generatedAt: "2026-10-01T10:00:00.000Z",
  since: null,
  vendors: [],
  payments: [
    payment("apollo io", "2026-01-28", 100),
    payment("apollo io", "2026-02-28", 100),
    payment("scrape do scrape", "2026-04-22", 30),
    payment("scrape do scrape", "2026-04-23", 10, "refund"),
    payment("hunter io starter", "2026-01-18", 49),
  ],
};

const fig = (costName: string, costSource: "platform" | "org", quantity: string, refundedQuantity = "0.000000") => ({ costName, costSource, quantity, refundedQuantity });
const CONSUMPTION = {
  timezone: "UTC",
  since: "2026-01-01",
  statuses: ["actual", "refunded"],
  days: [
    { day: "2026-02-01", ...fig("apollo-credit", "platform", "4000.000000") },
    { day: "2026-02-01", ...fig("apollo-search-credit", "platform", "900.000000") },
    { day: "2026-03-01", ...fig("apollo-enrichment-credit", "platform", "1000.000000") },
    { day: "2026-03-01", ...fig("apollo-credit", "org", "5000.000000") },
    { day: "2026-04-24", ...fig("scrape-do-credit", "platform", "20000.000000") },
  ],
  totals: [],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubUpstreams(u: { ledger: () => Response; runs: () => Response }) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://ledger.test/api/v1/vendor-payments")) return u.ledger();
    if (url.startsWith("http://runs.test/internal/stats/costs/consumption")) return u.runs();
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function cleanTables() {
  await db.delete(subscriptionCostDaily);
  await db.delete(subscriptionSpendDaily);
  await db.delete(subscriptionConsumptionDaily);
  await db.delete(subscriptionCostRawReads);
  await db.delete(subscriptionCostRefreshes);
}

describe("/internal/subscription-costs — real cost per credit of each subscription", () => {
  const app = createTestApp();

  beforeEach(async () => {
    process.env.LEDGER_API_URL = "https://ledger.test/";
    process.env.LEDGER_API_KEY = "kla_test";
    process.env.RUNS_SERVICE_URL = "http://runs.test";
    process.env.RUNS_SERVICE_API_KEY = "runs_test";
    await cleanTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LEDGER_API_URL;
    delete process.env.LEDGER_API_KEY;
    delete process.env.RUNS_SERVICE_URL;
    delete process.env.RUNS_SERVICE_API_KEY;
  });

  afterAll(cleanTables);

  it("refuses a caller without the service api key, on the read and the refresh", async () => {
    expect((await request(app).get("/internal/subscription-costs")).status).toBe(401);
    expect((await request(app).post("/internal/subscription-costs/refresh")).status).toBe(401);
  });

  it("answers 503, never a zero cost, before the first refresh", async () => {
    const res = await request(app).get("/internal/subscription-costs").set(API_KEY);
    expect(res.status).toBe(503);
    expect(res.body.subscriptions).toBeUndefined();
  });

  it("reads the declared vendors and cost names since 2026-01-01 and serves a dense series dated today", async () => {
    const fetchMock = stubUpstreams({ ledger: () => json(LEDGER), runs: () => json(CONSUMPTION) });
    const today = utcDay(new Date());
    const refresh = await request(app).post("/internal/subscription-costs/refresh").set(API_KEY);
    expect(refresh.status).toBe(200);
    expect(refresh.body).toMatchObject({ asOf: today, subscriptions: 9 });

    const runsCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("consumption"))!;
    const runsUrl = new URL(String(runsCall[0]));
    expect(runsUrl.searchParams.get("since")).toBe("2026-01-01");
    expect(runsUrl.searchParams.get("costNames")!.split(",")).toContain("apollo-search-credit");
    expect(((runsCall[1] as RequestInit).headers as Record<string, string>)["x-api-key"]).toBe("runs_test");

    const res = await request(app).get("/internal/subscription-costs").set(API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ since: "2026-01-01", asOf: today, stale: false });

    const apollo = res.body.subscriptions.find((s: { key: string }) => s.key === "apollo");
    // 200 USD over 4000 + 1000 platform credits = 4 US cents; search and customer-key units left out
    expect(apollo).toMatchObject({ paidUsd: 200, netUsd: 200, credits: 5000, costPerCreditUsdCents: 4, costPerCreditNullReason: null });
    expect(apollo.firstPaymentOn).toBe("2026-01-28");
    expect(apollo.daily[0].day).toBe("2026-01-01");
    expect(apollo.daily[apollo.daily.length - 1].day).toBe(today);
    const search = apollo.costItems.find((c: { costName: string }) => c.costName === "apollo-search-credit");
    expect(search).toMatchObject({ isCredit: false, quantityPlatformKey: 900, creditsCounted: 0 });
    const credit = apollo.costItems.find((c: { costName: string }) => c.costName === "apollo-credit");
    expect(credit).toMatchObject({ isCredit: true, quantityPlatformKey: 4000, quantityOrgKey: 5000, creditsCounted: 4000 });
    const feb = apollo.monthly.find((m: { month: string }) => m.month === "2026-02");
    expect(feb).toMatchObject({ paidUsd: 100, credits: 4000, monthCostPerCreditUsdCents: 2.5 });

    const scrape = res.body.subscriptions.find((s: { key: string }) => s.key === "scrape-do");
    expect(scrape).toMatchObject({ paidUsd: 30, refundedUsd: 10, netUsd: 20, credits: 20000, costPerCreditUsdCents: 0.1, grossCostPerCreditUsdCents: 0.15 });

    const hunter = res.body.subscriptions.find((s: { key: string }) => s.key === "hunter");
    expect(hunter).toMatchObject({ paidUsd: 49, credits: 0, costPerCreditUsdCents: null, costPerCreditNullReason: "no-credit-consumed" });

    const explee = res.body.subscriptions.find((s: { key: string }) => s.key === "explee");
    expect(explee).toMatchObject({ ledgerMatched: false, paidUsd: null, netUsd: null, costPerCreditUsdCents: null, costPerCreditNullReason: "no-ledger-line" });

    const raw = await db.select().from(subscriptionCostRawReads);
    expect(raw.map((r) => r.source).sort()).toEqual(["bank-ledger", "runs-service"]);
  });

  it("prices a credit EXCLUDING VAT, the VAT taken out served beside it (owner 2026-10-01)", async () => {
    // Scrape.do declared 20% here: 36 USD at the bank = 30 cost + 6 VAT; the 12 USD refund = 10 + 2.
    const withVat = LEDGER.payments.map((p) =>
      p.vendor === "scrape do scrape" ? { ...p, usdAmount: p.usdAmount * 1.2, amount: p.usdAmount * 1.2, vat: declaredVat(p.usdAmount * 1.2, 0.2) } : p,
    );
    stubUpstreams({ ledger: () => json({ ...LEDGER, payments: withVat }), runs: () => json(CONSUMPTION) });
    expect((await request(app).post("/internal/subscription-costs/refresh").set(API_KEY)).status).toBe(200);
    const res = await request(app).get("/internal/subscription-costs").set(API_KEY);
    const scrape = res.body.subscriptions.find((s: { key: string }) => s.ledgerVendors.some((v: { key: string }) => v.key === "scrape do scrape"));
    expect(scrape).toMatchObject({ paidUsd: 30, refundedUsd: 10, netUsd: 20, vatUsd: 4, costPerCreditUsdCents: 0.1 });
    expect(scrape.vatBasis).toMatch(/^declared 20%/);
    expect(scrape.ledgerVendors[0]).toMatchObject({ netUsd: 20, vatUsd: 4 });
    expect(res.body.vatRule).toMatch(/EXCLUDING VAT/);
  });

  it("is idempotent: a second refresh the same day writes the same series", async () => {
    stubUpstreams({ ledger: () => json(LEDGER), runs: () => json(CONSUMPTION) });
    await refreshSubscriptionCosts();
    const first = await readStoredSubscriptionCosts();
    await refreshSubscriptionCosts();
    const second = await readStoredSubscriptionCosts();
    expect(second.series).toEqual(first.series);
    expect(second.consumption).toEqual(first.consumption);
    expect(await db.select().from(subscriptionCostRawReads)).toHaveLength(2);
  });

  it("fails loud when runs-service cannot answer and keeps the last series served", async () => {
    stubUpstreams({ ledger: () => json(LEDGER), runs: () => json(CONSUMPTION) });
    await refreshSubscriptionCosts();
    const before = (await request(app).get("/internal/subscription-costs").set(API_KEY)).body;

    stubUpstreams({ ledger: () => json(LEDGER), runs: () => json({ error: "boom" }, 500) });
    const failed = await request(app).post("/internal/subscription-costs/refresh").set(API_KEY);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/runs-service refused/);

    const after = (await request(app).get("/internal/subscription-costs").set(API_KEY)).body;
    const figures = (b: { subscriptions: { daily: unknown; monthly: unknown; costPerCreditUsdCents: unknown }[] }) =>
      b.subscriptions.map((x) => [x.costPerCreditUsdCents, x.daily, x.monthly]);
    expect(figures(after)).toEqual(figures(before));
    expect(after.refreshedAt).toBe(before.refreshedAt);
    expect(after.lastRefresh).toMatchObject({ status: "failed" });
    expect(after.lastRefresh.error).toMatch(/HTTP 500/);
  });

  it("fails loud when the ledger never paid a declared vendor, and when runs-service is not configured", async () => {
    stubUpstreams({ ledger: () => json({ error: "never paid" }, 404), runs: () => json(CONSUMPTION) });
    expect((await request(app).post("/internal/subscription-costs/refresh").set(API_KEY)).status).toBe(502);
    delete process.env.RUNS_SERVICE_URL;
    stubUpstreams({ ledger: () => json(LEDGER), runs: () => json(CONSUMPTION) });
    const res = await request(app).post("/internal/subscription-costs/refresh").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/RUNS_SERVICE_URL missing/);
    expect((await request(app).get("/internal/subscription-costs").set(API_KEY)).status).toBe(503);
  });

  it("fails loud on a cost name runs-service was not asked for", async () => {
    const odd = { ...CONSUMPTION, days: [...CONSUMPTION.days, { day: "2026-05-01", ...fig("anthropic-tokens", "platform", "1") }] };
    stubUpstreams({ ledger: () => json(LEDGER), runs: () => json(odd) });
    const res = await request(app).post("/internal/subscription-costs/refresh").set(API_KEY);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not asked for: anthropic-tokens/);
  });
});
