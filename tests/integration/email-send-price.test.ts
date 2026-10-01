import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { db } from "../../src/db/index.js";
import {
  emailInfraSpendDaily,
  emailSendPriceDaily,
  emailSendPriceRawReads,
  emailSendPriceRefreshes,
  emailsToLeadsDaily,
} from "../../src/db/schema.js";
import { refreshEmailSendPrice, utcDay } from "../../src/db/email-send-price.js";

const API_KEY = { "x-api-key": "test-api-key" };

function payment(vendor: string, bookedOn: string, usdAmount: number, direction: "payment" | "refund" = "payment") {
  return { id: `acc:${vendor}:${bookedOn}:${usdAmount}`, vendor, bookedOn, direction, amount: usdAmount, currency: "USD", eurAmount: usdAmount * 0.9, usdAmount, accountId: "acc" };
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
    // gross: (40 + 97 + 63) USD = 200 USD over 6000 emails = 3.3333 US cents; the 3 USD refund is served apart
    expect(res.body.totals).toEqual({ spendUsd: 200, refundedUsd: 3, emailsToLeads: 6000 });
    expect(res.body.currentPriceUsdCents).toBeCloseTo(3.3333, 4);
    expect(res.body.asOf).toBe(today);
    expect(res.body.stale).toBe(false);
    expect(res.body.firstPaymentOn).toBe("2026-02-10");
    expect(res.body.firstSendOn).toBe("2026-02-19");

    const daily = res.body.daily as { day: string; priceUsdCents: number | null }[];
    expect(daily[0].day).toBe("2026-02-10");
    expect(daily[daily.length - 1].day).toBe(today);
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse("2026-02-10T00:00:00Z")) / 86_400_000) + 1;
    expect(daily).toHaveLength(days);
    expect(daily.find((d) => d.day === "2026-02-18")!.priceUsdCents).toBeNull();
    expect(daily.find((d) => d.day === "2026-02-19")!.priceUsdCents).toBe(4); // 40 USD / 1000

    const forge = res.body.vendors.find((v: { key: string }) => v.key === "forge");
    expect(forge).toMatchObject({ firstPaidOn: "2026-03-05", lastPaidOn: "2026-03-05", paidUsd: 63, refundedUsd: 3, netUsd: 60, refunds: 1 });
    const cloudflare = res.body.vendors.find((v: { key: string }) => v.key === "cloudflare");
    expect(cloudflare).toMatchObject({ firstPaidOn: null, netUsd: 0 });

    const march = res.body.monthly.find((m: { month: string }) => m.month === "2026-03");
    expect(march).toMatchObject({ spendUsd: 63, spendByVendorUsd: { forge: 63, instantly: 0 }, emailsToLeads: 5000, monthPriceUsdCents: 1.26 });
    expect(march.cumulativeSpendUsd).toBe(200);

    const raw = await db.select().from(emailSendPriceRawReads);
    expect(raw.map((r) => r.source).sort()).toEqual(["bank-ledger", "instantly-service"]);
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
