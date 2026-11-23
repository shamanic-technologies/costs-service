import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { declaredVat, UNKNOWN_VAT } from "../helpers/ledger-vat.js";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { db } from "../../src/db/index.js";
import {
  emailInfraSpendCoverage,
  emailInfraSpendDaily,
  emailSendPriceDaily,
  emailSendPriceRawReads,
  emailSendPriceRefreshes,
  emailsToLeadsDaily,
} from "../../src/db/schema.js";
import { refreshEmailSendPrice, utcDay } from "../../src/db/email-send-price.js";

const API_KEY = { "x-api-key": "test-api-key" };

function payment(vendor: string, bookedOn: string, usdAmount: number, direction: "payment" | "refund" = "payment") {
  return { id: `acc:${vendor}:${bookedOn}:${usdAmount}`, vendor, bookedOn, direction, amount: usdAmount, currency: "USD", eurAmount: usdAmount * 0.9, usdAmount, accountId: "acc", vat: declaredVat(usdAmount, 0, usdAmount * 0.9) };
}

const LEDGER = {
  generatedAt: "2026-10-01T10:00:00.000Z",
  since: null,
  vendors: [],
  payments: [
    payment("gandi order", "2026-02-10", 40),
    payment("instantly", "2026-02-20", 97),
    payment("forge", "2026-03-05", 63),
    payment("forge", "2026-03-06", 3, "refund"),
  ],
};

const SENDS = {
  grain: "day",
  timezone: "UTC",
  since: null,
  asOf: "2026-10-01T10:00:00.000Z",
  totals: { toLeads: 6000, manualReplies: 3, warmup: 50, warmupReplies: 10, seeds: 5 },
  periods: [
    { periodStart: "2026-02-19", periodEnd: "2026-02-20", inProgress: false, toLeads: 1000, manualReplies: 3, warmup: 50, warmupReplies: 10, seeds: 5, leadsEmailed: 900 },
    { periodStart: "2026-03-10", periodEnd: "2026-03-11", inProgress: false, toLeads: 5000, manualReplies: 0, warmup: 0, warmupReplies: 0, seeds: 0, leadsEmailed: 4000 },
  ],
};

type Upstream = { ledger: () => Response | Promise<Response>; instantly: () => Response | Promise<Response> };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubUpstreams(u: Upstream) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://ledger.test/api/v1/vendor-payments")) return u.ledger();
    if (url.startsWith("http://instantly.test/internal/ops/sent-per-period")) return u.instantly();
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function cleanTables() {
  await db.delete(emailSendPriceDaily);
  await db.delete(emailInfraSpendDaily);
  await db.delete(emailInfraSpendCoverage);
  await db.delete(emailsToLeadsDaily);
  await db.delete(emailSendPriceRawReads);
  await db.delete(emailSendPriceRefreshes);
}

describe("/internal/email-send-price — price of one cold email sent to a lead", () => {
  const app = createTestApp();

  beforeEach(async () => {
    process.env.LEDGER_API_URL = "https://ledger.test/";
    process.env.LEDGER_API_KEY = "kla_test";
    process.env.INSTANTLY_SERVICE_URL = "http://instantly.test";
    process.env.INSTANTLY_SERVICE_API_KEY = "inst_test";
    await cleanTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LEDGER_API_URL;
    delete process.env.LEDGER_API_KEY;
    delete process.env.INSTANTLY_SERVICE_URL;
    delete process.env.INSTANTLY_SERVICE_API_KEY;
  });

  afterAll(cleanTables);

  it("refuses a caller without the service api key, on the read and the refresh", async () => {
    expect((await request(app).get("/internal/email-send-price")).status).toBe(401);
    expect((await request(app).post("/internal/email-send-price/refresh")).status).toBe(401);
  });

  it("prices the email EXCLUDING VAT, the VAT taken out served beside it (owner 2026-10-01)", async () => {
    // Gandi bills 40 USD + 20% VAT = 48 USD at the bank: 40 is the cost, 8 the VAT.
    const gandi = { ...payment("gandi order", "2026-02-10", 48), vat: declaredVat(48, 0.2, 48 * 0.9) };
    stubUpstreams({ ledger: () => json({ ...LEDGER, payments: [gandi, ...LEDGER.payments.slice(1)] }), instantly: () => json(SENDS) });
    expect((await request(app).post("/internal/email-send-price/refresh").set(API_KEY)).status).toBe(200);
    const res = await request(app).get("/internal/email-send-price").set(API_KEY);
    expect(res.body.totals).toMatchObject({ spendUsd: 197, paidUsd: 200, vatUsd: 8 });
    expect(res.body.sinceInceptionPriceUsdCents).toBeCloseTo(3.2833, 4);
    expect(res.body.vendors.find((v: { key: string }) => v.key === "gandi order")).toMatchObject({ paidUsd: 40, vatUsd: 8, vatBasis: "declared 20%: Every line is a price x 1.2" });
    expect(res.body.vatRule).toMatch(/EXCLUDING VAT/);
  });

  it("fails the refresh (502) on a line whose VAT the ledger cannot state, never reading it as 0%", async () => {
    const unknown = { ...payment("forge", "2026-03-07", 10), vat: UNKNOWN_VAT };
    stubUpstreams({ ledger: () => json({ ...LEDGER, payments: [...LEDGER.payments, unknown] }), instantly: () => json(SENDS) });
    const res = await request(app).post("/internal/email-send-price/refresh").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/cannot state the VAT.*forge 2026-03-07/);
  });

  it("answers 503, never a zero price, before the first refresh", async () => {
    const res = await request(app).get("/internal/email-send-price").set(API_KEY);
    expect(res.status).toBe(503);
    expect(res.body.currentPriceUsdCents).toBeUndefined();
  });

  it("asks the ledger for the declared vendors and serves a dense series whose last point is today", async () => {
    const fetchMock = stubUpstreams({ ledger: () => json(LEDGER), instantly: () => json(SENDS) });
    const today = utcDay(new Date());
    const refresh = await request(app).post("/internal/email-send-price/refresh").set(API_KEY);
    expect(refresh.status).toBe(200);
    expect(refresh.body.asOf).toBe(today);

    const ledgerUrl = new URL(String(fetchMock.mock.calls.find((c) => String(c[0]).includes("vendor-payments"))![0]));
    expect(ledgerUrl.searchParams.get("vendors")).toBe("instantly,forge,gandi order,cloudflare");
    const ledgerInit = fetchMock.mock.calls.find((c) => String(c[0]).includes("vendor-payments"))![1] as RequestInit;
    expect((ledgerInit.headers as Record<string, string>).Authorization).toBe("Bearer kla_test");

    const res = await request(app).get("/internal/email-send-price").set(API_KEY);
    expect(res.status).toBe(200);
    // net: (40 + 97 + 63 - 3) USD = 197 USD over 6000 emails = 3.2833 US cents; gross 200 USD = 3.3333 beside it
    expect(res.body.totals).toEqual({ spendUsd: 197, paidUsd: 200, refundedUsd: 3, emailsToLeads: 6000, vatUsd: 0, vatBasis: "declared 0%: Bills excluding VAT (owner 2026-10-01)" });
    expect(res.body.sinceInceptionPriceUsdCents).toBeCloseTo(3.2833, 4);
    expect(res.body.currentGrossPriceUsdCents).toBeCloseTo(3.3333, 4);
    // Nothing was sent in the last 30 days: no current price over zero emails, whatever still runs.
    expect(res.body.currentPriceUsdCents).toBeNull();
    expect(res.body.runningCost.trailingEmailsPerDay).toBe(0);
    for (const l of res.body.runningCost.lines as { coversFrom: string; coversUntil: string }[]) {
      expect(l.coversFrom <= today && today < l.coversUntil).toBe(true);
    }
    expect(res.body.asOf).toBe(today);
    expect(res.body.stale).toBe(false);
    expect(res.body.firstPaymentOn).toBe("2026-02-10");
    expect(res.body.firstSendOn).toBe("2026-02-19");

    const daily = res.body.daily as { day: string; priceUsdCents: number | null; sinceInceptionPriceUsdCents: number | null }[];
    expect(daily[0].day).toBe("2026-02-10");
    expect(daily[daily.length - 1].day).toBe(today);
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse("2026-02-10T00:00:00Z")) / 86_400_000) + 1;
    expect(daily).toHaveLength(days);
    expect(daily.find((d) => d.day === "2026-02-18")!.sinceInceptionPriceUsdCents).toBeNull();
    expect(daily.find((d) => d.day === "2026-02-19")!.sinceInceptionPriceUsdCents).toBe(4); // 40 USD / 1000
    // Current price on 2026-03-12, every payment covering that day / its days: Gandi 40 USD over a year,
    // Instantly 97 USD over Feb 20 - Mar 20 (28 days), forge 63 USD minus its 3 USD refund over a month
    // each (31 days); 6000 emails over the 30 days before = 200 a day.
    expect(daily.find((d) => d.day === "2026-03-12")!.priceUsdCents).toBeCloseTo((4000 / 365 + 9700 / 28 + 6000 / 31) / 200, 4);
    // Instantly's month is over on 2026-03-20: it stops loading.
    expect(daily.find((d) => d.day === "2026-03-20")!.priceUsdCents).toBeCloseTo((4000 / 365 + 6000 / 31) / 200, 4);

    const forge = res.body.vendors.find((v: { key: string }) => v.key === "forge");
    expect(forge).toMatchObject({ firstPaidOn: "2026-03-05", lastPaidOn: "2026-03-05", paidUsd: 63, refundedUsd: 3, netUsd: 60, refunds: 1 });
    const cloudflare = res.body.vendors.find((v: { key: string }) => v.key === "cloudflare");
    expect(cloudflare).toMatchObject({ firstPaidOn: null, netUsd: 0 });

    const march = res.body.monthly.find((m: { month: string }) => m.month === "2026-03");
    expect(march).toMatchObject({ spendUsd: 60, paidUsd: 63, refundedUsd: 3, spendByVendorUsd: { forge: 60, instantly: 0 }, emailsToLeads: 5000, monthPriceUsdCents: 1.2 });
    expect(march).toMatchObject({ cumulativeSpendUsd: 197, cumulativePaidUsd: 200 });

    const raw = await db.select().from(emailSendPriceRawReads);
    expect(raw.map((r) => r.source).sort()).toEqual(["bank-ledger", "instantly-service"]);
  });

  it("prices today on the payments whose period covers today, over the last 30 days of sends (EMAIL-PRICE-CURRENT-1123)", async () => {
    const today = utcDay(new Date());
    const shift = (n: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const periods = Array.from({ length: 30 }, (_, i) => ({
      periodStart: shift(-30 + i), periodEnd: shift(-29 + i), inProgress: false, toLeads: 1000, manualReplies: 0, warmup: 0, warmupReplies: 0, seeds: 0, leadsEmailed: 1000,
    }));
    // Declared terms: instantly = 1 month (this plan is long over, sunk), gandi order = 12 months.
    const ledger = {
      ...LEDGER,
      payments: [payment("instantly", shift(-400), 9700), payment("gandi order", shift(-10), 365)],
    };
    stubUpstreams({ ledger: () => json(ledger), instantly: () => json({ ...SENDS, periods }) });
    expect((await request(app).post("/internal/email-send-price/refresh").set(API_KEY)).status).toBe(200);
    const res = await request(app).get("/internal/email-send-price").set(API_KEY);
    const lines = res.body.runningCost.lines as { vendor: string; coversUntil: string; perDayUsdCents: number }[];
    expect(lines.map((l) => l.vendor)).toEqual(["gandi order"]);
    const perDay = 36_500 / Math.round((Date.parse(`${lines[0].coversUntil}T00:00:00Z`) - Date.parse(`${shift(-10)}T00:00:00Z`)) / 86_400_000);
    expect(res.body.currentPriceUsdCents).toBeCloseTo(perDay / 1000, 4);
    expect(res.body.runningCost.trailingEmailsPerDay).toBe(1000);
    expect(res.body.runningCost.byVendor.find((v: { key: string }) => v.key === "instantly")).toMatchObject({ perDayUsdCents: 0, priceUsdCents: 0 });
    // The superseded average still carries the 9,700 USD plan: served beside, much higher.
    expect(res.body.sinceInceptionPriceUsdCents).toBeGreaterThan(res.body.currentPriceUsdCents * 100);
    expect(await db.select().from(emailInfraSpendCoverage)).toHaveLength(2);
  });

  it("is idempotent: a second refresh the same day writes the same series", async () => {
    stubUpstreams({ ledger: () => json(LEDGER), instantly: () => json(SENDS) });
    await refreshEmailSendPrice();
    const first = (await request(app).get("/internal/email-send-price").set(API_KEY)).body;
    await refreshEmailSendPrice();
    const second = (await request(app).get("/internal/email-send-price").set(API_KEY)).body;
    expect(second.daily).toEqual(first.daily);
    expect(second.monthly).toEqual(first.monthly);
    expect(await db.select().from(emailSendPriceRawReads)).toHaveLength(2);
    expect(await db.select().from(emailInfraSpendDaily)).toHaveLength(4);
  });

  it("fails loud when an upstream cannot answer and keeps the last series served with its as-of", async () => {
    stubUpstreams({ ledger: () => json(LEDGER), instantly: () => json(SENDS) });
    await refreshEmailSendPrice();
    const before = (await request(app).get("/internal/email-send-price").set(API_KEY)).body;

    stubUpstreams({ ledger: () => json(LEDGER), instantly: () => json({ error: "boom" }, 500) });
    const failed = await request(app).post("/internal/email-send-price/refresh").set(API_KEY);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/instantly-service refused/);

    const after = (await request(app).get("/internal/email-send-price").set(API_KEY)).body;
    expect(after.currentPriceUsdCents).toBe(before.currentPriceUsdCents);
    expect(after.daily).toEqual(before.daily);
    expect(after.lastRefresh).toMatchObject({ status: "failed" });
    expect(after.lastRefresh.error).toMatch(/HTTP 500/);
  });

  it("fails loud when the ledger has never paid a declared vendor (no silent zero for a typo)", async () => {
    stubUpstreams({
      ledger: () => json({ error: 'The ledger never paid "cloudflare"', unknownVendors: ["cloudflare"] }, 404),
      instantly: () => json(SENDS),
    });
    const res = await request(app).post("/internal/email-send-price/refresh").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/HTTP 404/);
    expect((await request(app).get("/internal/email-send-price").set(API_KEY)).status).toBe(503);
  });

  it("fails loud when instantly-service is not configured", async () => {
    delete process.env.INSTANTLY_SERVICE_URL;
    stubUpstreams({ ledger: () => json(LEDGER), instantly: () => json(SENDS) });
    const res = await request(app).post("/internal/email-send-price/refresh").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/INSTANTLY_SERVICE_URL missing/);
  });
});
