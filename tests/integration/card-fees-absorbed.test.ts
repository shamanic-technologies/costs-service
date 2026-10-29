import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";

// Owner 2026-10-13: card-acquiring fees are the platform's cost, never a customer's. The five
// names leave the current catalogue listings, while the by-name read runs-service prices each
// fee cost row from stays byte-for-byte what it was (1 cent per cent of fee).
const CARD_FEES = [
  "stripe-processing-fee",
  "stripe-refund-fee",
  "stripe-dispute-fee",
  "stripe-payout-failure-fee",
  "revolut-acquiring-fee",
];

describe("card-acquiring fees are absorbed by the platform", { timeout: 60_000 }, () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  beforeEach(async () => {
    await cleanTestData();
    await seedProvidersCosts();
    await seedPlatformCosts();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("are absent from the public price listing, which is otherwise intact", async () => {
    const res = await request(app).get("/v1/platform-prices");
    expect(res.status).toBe(200);
    const names = res.body.map((p: { name: string }) => p.name);
    for (const name of CARD_FEES) expect(names, name).not.toContain(name);
    expect(names).toContain("google-ads-spend");
    expect(names).toContain("meta-ads-spend");
    expect(res.body.length).toBeGreaterThan(50);
  });

  it("are absent from the current provider-costs catalogue", async () => {
    const res = await request(app).get("/v1/providers-costs").set(identityHeaders);
    expect(res.status).toBe(200);
    const names = res.body.map((c: { name: string }) => c.name);
    for (const name of CARD_FEES) expect(names, name).not.toContain(name);
    expect(names).toContain("google-ads-spend");
  });

  it("still price by name exactly as runs-service needs to record the fee", async () => {
    for (const name of CARD_FEES) {
      const res = await request(app).get(`/v1/platform-prices/${name}`);
      expect(res.status, name).toBe(200);
      expect(res.body.name, name).toBe(name);
      expect(res.body.pricePerUnitInUsdCents, name).toBe("1.0000000000");
      expect(res.body.pricingBasis, name).toBe("pass-through");
      expect(res.body.unit, name).toBe("USD cent");
    }
  });

  it("keep their history and plan reads", async () => {
    for (const name of CARD_FEES) {
      const one = await request(app).get(`/v1/providers-costs/${name}`).set(identityHeaders);
      expect(one.status, name).toBe(200);
      const hist = await request(app).get(`/v1/providers-costs/${name}/history`).set(identityHeaders);
      expect(hist.status, name).toBe(200);
    }
  });
});
