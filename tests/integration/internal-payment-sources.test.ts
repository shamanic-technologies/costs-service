import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost } from "../helpers/test-db.js";

const API_KEY = { "x-api-key": "test-api-key" };

const LEDGER = {
  generatedAt: "2026-10-01T12:00:00.000Z",
  vendors: [
    {
      key: "openai chatgpt",
      name: "Openai Chatgpt",
      lastPaidOn: "2026-09-28",
      paidFrom: [
        { accountId: "rev-perso", label: "Revolut", institutionDomain: "revolut.com", scope: "personal", connector: "enable-banking", lastPaidOn: "2026-09-28" },
        { accountId: "qonto-1", label: "Qonto", institutionDomain: "qonto.com", scope: "business", connector: "qonto", lastPaidOn: "2026-08-03" },
      ],
    },
    {
      key: "openai",
      name: "OpenAI",
      lastPaidOn: "2026-09-10",
      paidFrom: [{ accountId: "qonto-1", label: "Qonto", institutionDomain: "qonto.com", scope: "business", connector: "qonto", lastPaidOn: "2026-09-10" }],
    },
    { key: "boulangerie", name: "Boulangerie", lastPaidOn: "2026-09-30", paidFrom: [] },
  ],
};

function stubLedger(response: () => Promise<Response>) {
  const fetchMock = vi.fn(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("/internal/provider-payment-sources — who pays each vendor, read from the bank ledger", () => {
  const app = createTestApp();

  beforeEach(async () => {
    process.env.LEDGER_API_URL = "https://ledger.test/";
    process.env.LEDGER_API_KEY = "kla_test";
    await cleanTestData();
    await insertTestProviderCost({
      name: "openai-test-tokens", provider: "openai", planTier: "pay-as-you-go", billingCycle: "monthly",
      costPerUnitInUsdCents: "0.001", providerDomain: "openai.com",
    });
    await insertTestProviderCost({
      name: "apollo-test-credit", provider: "apollo", planTier: "basic", billingCycle: "monthly",
      costPerUnitInUsdCents: "1",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LEDGER_API_URL;
    delete process.env.LEDGER_API_KEY;
  });

  afterAll(async () => {
    await cleanTestData();
  });

  it("refuses without the service api key", async () => {
    const fetchMock = stubLedger(async () => new Response(JSON.stringify(LEDGER)));
    const res = await request(app).get("/internal/provider-payment-sources");
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves every catalogue provider joined to the ledger, unmatched ones marked so", async () => {
    const fetchMock = stubLedger(async () => new Response(JSON.stringify(LEDGER), { status: 200 }));
    const res = await request(app).get("/internal/provider-payment-sources").set(API_KEY);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ledger.test/api/v1/vendors",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer kla_test" }) }),
    );
    expect(res.body.ledgerGeneratedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(res.body.providers).toEqual([
      { provider: "apollo", providerDomain: null, match: "unmatched", ledgerVendors: [], lastPaidOn: null, paidFrom: [] },
      {
        provider: "openai",
        providerDomain: "openai.com",
        match: "matched",
        ledgerVendors: [{ key: "openai chatgpt", name: "Openai Chatgpt" }, { key: "openai", name: "OpenAI" }],
        lastPaidOn: "2026-09-28",
        paidFrom: [
          { accountId: "rev-perso", label: "Revolut", institutionDomain: "revolut.com", scope: "personal", lastPaidOn: "2026-09-28" },
          { accountId: "qonto-1", label: "Qonto", institutionDomain: "qonto.com", scope: "business", lastPaidOn: "2026-09-10" },
        ],
      },
    ]);
  });

  it("is a 502 naming the cause when the ledger is not configured", async () => {
    delete process.env.LEDGER_API_KEY;
    const fetchMock = stubLedger(async () => new Response(JSON.stringify(LEDGER)));
    const res = await request(app).get("/internal/provider-payment-sources").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("LEDGER_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a 502 when the ledger refuses the key", async () => {
    stubLedger(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    const res = await request(app).get("/internal/provider-payment-sources").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("HTTP 401");
  });

  it("is a 502 when the ledger is unreachable", async () => {
    stubLedger(async () => {
      throw new TypeError("fetch failed");
    });
    const res = await request(app).get("/internal/provider-payment-sources").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("unreachable");
  });

  it("is a 502 when the ledger answers in a shape we do not know", async () => {
    stubLedger(async () => new Response(JSON.stringify({ vendors: "nope" }), { status: 200 }));
    const res = await request(app).get("/internal/provider-payment-sources").set(API_KEY);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("unexpected shape");
  });

  it("no longer serves the hand-edited vocabulary or the write route", async () => {
    stubLedger(async () => new Response(JSON.stringify(LEDGER)));
    expect((await request(app).get("/internal/payment-sources").set(API_KEY)).status).toBe(404);
    expect((await request(app).put("/internal/provider-payment-sources/openai").set(API_KEY).send({ sources: [] })).status).toBe(404);
  });
});
