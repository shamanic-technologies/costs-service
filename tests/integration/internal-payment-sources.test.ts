import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost } from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { paymentSources } from "../../src/db/schema.js";

const API_KEY = { "x-api-key": "test-api-key" };
const SEEDED = ["qonto", "revolut_business", "revolut_personal", "stripe"];

describe("/internal/payment-sources + /internal/provider-payment-sources — who pays each vendor", () => {
  const app = createTestApp();

  beforeEach(async () => {
    await cleanTestData();
    await db.delete(paymentSources).where(inArray(paymentSources.key, ["wise_business", "bad_domain"]));
    await insertTestProviderCost({
      name: "openai-test-tokens", provider: "openai", planTier: "pay-as-you-go", billingCycle: "monthly",
      costPerUnitInUsdCents: "0.001", providerDomain: "openai.com",
    });
    await insertTestProviderCost({
      name: "apollo-test-credit", provider: "apollo", planTier: "basic", billingCycle: "monthly",
      costPerUnitInUsdCents: "1",
    });
  });

  afterAll(async () => {
    await cleanTestData();
    await db.delete(paymentSources).where(inArray(paymentSources.key, ["wise_business"]));
  });

  it("refuses every route without the service api key", async () => {
    const calls = [
      request(app).get("/internal/payment-sources").set(getIdentityHeaders()),
      request(app).put("/internal/payment-sources/wise_business").send({ displayName: "Wise", domain: "wise.com" }),
      request(app).get("/internal/provider-payment-sources"),
      request(app).put("/internal/provider-payment-sources/openai").send({ sources: ["qonto"] }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });

  it("ships the vocabulary with display names and logo domains", async () => {
    const res = await request(app).get("/internal/payment-sources").set(API_KEY);
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.sources.map((s: { key: string }) => [s.key, s]));
    for (const key of SEEDED) expect(byKey[key]).toBeDefined();
    expect(byKey.revolut_business).toEqual({ key: "revolut_business", displayName: "Revolut Business", domain: "revolut.com" });
    expect(byKey.revolut_personal).toEqual({ key: "revolut_personal", displayName: "Revolut Personal", domain: "revolut.com" });
    expect(byKey.stripe).toEqual({ key: "stripe", displayName: "Stripe", domain: "stripe.com" });
    expect(byKey.qonto).toEqual({ key: "qonto", displayName: "Qonto", domain: "qonto.com" });
  });

  it("lists every catalogue provider with an empty list when nothing is stated", async () => {
    const res = await request(app).get("/internal/provider-payment-sources").set(API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual([
      { provider: "apollo", providerDomain: null, sources: [] },
      { provider: "openai", providerDomain: "openai.com", sources: [] },
    ]);
  });

  it("sets, replaces and clears a provider's sources", async () => {
    const set = await request(app)
      .put("/internal/provider-payment-sources/openai")
      .set(API_KEY)
      .send({ sources: ["revolut_business", "qonto", "qonto"] });
    expect(set.status).toBe(200);
    expect(set.body.sources.map((s: { key: string }) => s.key)).toEqual(["qonto", "revolut_business"]);
    expect(set.body.sources[0]).toEqual({ key: "qonto", displayName: "Qonto", domain: "qonto.com" });

    const list = await request(app).get("/internal/provider-payment-sources").set(API_KEY);
    const openai = list.body.providers.find((p: { provider: string }) => p.provider === "openai");
    expect(openai.sources.map((s: { key: string }) => s.key)).toEqual(["qonto", "revolut_business"]);

    const replaced = await request(app).put("/internal/provider-payment-sources/openai").set(API_KEY).send({ sources: ["stripe"] });
    expect(replaced.body.sources.map((s: { key: string }) => s.key)).toEqual(["stripe"]);

    const cleared = await request(app).put("/internal/provider-payment-sources/openai").set(API_KEY).send({ sources: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.sources).toEqual([]);
  });

  it("refuses an unknown source key with a legible 400 and changes nothing", async () => {
    await request(app).put("/internal/provider-payment-sources/openai").set(API_KEY).send({ sources: ["qonto"] });
    const res = await request(app)
      .put("/internal/provider-payment-sources/openai")
      .set(API_KEY)
      .send({ sources: ["qonto", "paypal"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unknown payment source(s): paypal");
    expect(res.body.error).toContain("revolut_business");

    const list = await request(app).get("/internal/provider-payment-sources").set(API_KEY);
    const openai = list.body.providers.find((p: { provider: string }) => p.provider === "openai");
    expect(openai.sources.map((s: { key: string }) => s.key)).toEqual(["qonto"]);
  });

  it("404s a provider absent from the catalogue and 400s a malformed body", async () => {
    const missing = await request(app).put("/internal/provider-payment-sources/nobody").set(API_KEY).send({ sources: ["qonto"] });
    expect(missing.status).toBe(404);
    const malformed = await request(app).put("/internal/provider-payment-sources/openai").set(API_KEY).send({ sources: "qonto" });
    expect(malformed.status).toBe(400);
  });

  it("lets staff grow the vocabulary, then link the new source", async () => {
    const bad = await request(app).put("/internal/payment-sources/Wise-Business").set(API_KEY).send({ displayName: "Wise", domain: "wise.com" });
    expect(bad.status).toBe(400);
    const badDomain = await request(app).put("/internal/payment-sources/bad_domain").set(API_KEY).send({ displayName: "X", domain: "https://x" });
    expect(badDomain.status).toBe(400);

    const added = await request(app).put("/internal/payment-sources/wise_business").set(API_KEY).send({ displayName: "Wise Business", domain: "Wise.com" });
    expect(added.status).toBe(200);
    expect(added.body).toEqual({ key: "wise_business", displayName: "Wise Business", domain: "wise.com" });

    const again = await request(app).put("/internal/payment-sources/wise_business").set(API_KEY).send({ displayName: "Wise", domain: "wise.com" });
    expect(again.body.displayName).toBe("Wise");

    const linked = await request(app).put("/internal/provider-payment-sources/apollo").set(API_KEY).send({ sources: ["wise_business"] });
    expect(linked.status).toBe(200);
    expect(linked.body.sources).toEqual([{ key: "wise_business", displayName: "Wise", domain: "wise.com" }]);
  });

  it("leaves the existing catalogue responses without a payment-source field", async () => {
    await request(app).put("/internal/provider-payment-sources/openai").set(API_KEY).send({ sources: ["qonto"] });
    const res = await request(app).get("/v1/providers-costs").set(getIdentityHeaders());
    expect(JSON.stringify(res.body)).not.toMatch(/qonto|paymentSource/i);
  });
});
