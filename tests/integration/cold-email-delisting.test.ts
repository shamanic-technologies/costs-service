import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, closeDb, insertTestProviderCost } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";

// The cold-email infrastructure spend (Instantly subscriptions, MailForge, PrimeForge, the
// Claude Max seat) moved OFF the per-customer rebill and onto our own fixed costs in 2026-08,
// and instantly-service stopped declaring per-email spend. These three names must therefore
// stop being advertised as a current billable price — while staying individually resolvable,
// because runs-service holds historical cost rows under them and a reconcile sweep still
// PATCHes old holds by cost id.
const DELISTED = [
  "instantly-account-email-sent",
  "instantly-domain-email-sent",
  "instantly-contact-uploaded",
];

describe("cold-email lines are delisted, not deleted", { timeout: 60_000 }, () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  beforeEach(async () => {
    await cleanTestData();
    await seedProvidersCosts();
    await seedPlatformCosts();
  });

  afterAll(async () => {
    await cleanTestData();
  });

  it("serves none of them from the public price listing", async () => {
    const res = await request(app).get("/v1/platform-prices");
    expect(res.status).toBe(200);
    const names = res.body.map((p: { name: string }) => p.name);
    for (const name of DELISTED) {
      expect(names, `${name} must not be advertised`).not.toContain(name);
    }
    // The listing is otherwise intact — this is a delisting, not an outage.
    expect(res.body.length).toBeGreaterThan(50);
  });

  it("serves none of them from the current provider-costs catalog", async () => {
    const res = await request(app).get("/v1/providers-costs").set(identityHeaders);
    expect(res.status).toBe(200);
    const names = res.body.map((c: { name: string }) => c.name);
    for (const name of DELISTED) {
      expect(names, `${name} must not be in the current catalog`).not.toContain(name);
    }
  });

  it("still resolves each one by name, with no price rather than a zero", async () => {
    for (const name of DELISTED) {
      const res = await request(app).get(`/v1/platform-prices/${name}`);
      expect(res.status, `${name} must stay resolvable`).toBe(200);
      expect(res.body.name).toBe(name);
      expect(res.body.pricePerUnitInUsdCents, name).toBeNull();
      expect(res.body.billable, name).toBe(false);
      // A zero would claim the line is free. It is not — we still pay for the inboxes.
      expect(res.body.pricePerUnitInUsdCents).not.toBe("0.0000000000");
    }
  });

  it("still resolves each one on the catalog read and keeps its full history", async () => {
    for (const name of DELISTED) {
      const current = await request(app).get(`/v1/providers-costs/${name}`).set(identityHeaders);
      expect(current.status, `${name} must stay resolvable`).toBe(200);
      expect(current.body.costPerUnitInUsdCents).toBeNull();

      const history = await request(app)
        .get(`/v1/providers-costs/${name}/history`)
        .set(identityHeaders);
      expect(history.status).toBe(200);
      expect(history.body.length).toBeGreaterThan(0);
    }
  });

  it("never serves a superseded price in place of a delisted line", async () => {
    // The guard that matters: the listing dedupes per name, so a delisted newest version must
    // suppress the name outright rather than fall through to the priced row underneath it —
    // which would resurrect a price we stopped charging.
    await cleanTestData();
    await insertTestProviderCost({
      name: "instantly-account-email-sent",
      provider: "instantly",
      providerDomain: "instantly.ai",
      type: "Email send (per account)",
      unit: "email",
      planTier: "hypergrowth",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "6.5481481480",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });
    await seedProvidersCosts();
    await seedPlatformCosts();

    const list = await request(app).get("/v1/platform-prices");
    const names = list.body.map((p: { name: string }) => p.name);
    expect(names).not.toContain("instantly-account-email-sent");

    const byName = await request(app).get("/v1/platform-prices/instantly-account-email-sent");
    expect(byName.status).toBe(200);
    expect(byName.body.pricePerUnitInUsdCents).toBeNull();

    // …and the price it used to be rebilled at is still readable.
    const history = await request(app)
      .get("/v1/providers-costs/instantly-account-email-sent/history")
      .set(identityHeaders);
    expect(
      history.body.map((r: { costPerUnitInUsdCents: string | null }) => r.costPerUnitInUsdCents)
    ).toContain("6.5481481480");
  });
});

describe("store markup after the cold-email spend moved to fixed costs", { timeout: 60_000 }, () => {
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

  it("prices a marked-up line at 6x the vendor rate", async () => {
    // anthropic-web-search: $0.01/search vendor rate = 1 USD cent × 6.
    const res = await request(app).get("/v1/platform-prices/anthropic-web-search");
    expect(res.status).toBe(200);
    expect(res.body.pricingBasis).toBe("marked-up");
    expect(res.body.billable).toBe(true);
    expect(res.body.pricePerUnitInUsdCents).toBe("6.0000000000");
  });

  it("keeps every routed line at exactly the vendor rate", async () => {
    // Pass-through is untouched by the markup change: 1 cent charged per USD cent of vendor
    // spend, on payment-processing fees and on every advertising channel.
    for (const name of ["stripe-processing-fee", "google-ads-spend", "meta-ads-spend"]) {
      const res = await request(app).get(`/v1/platform-prices/${name}`);
      expect(res.status, name).toBe(200);
      expect(res.body.pricingBasis, name).toBe("pass-through");
      expect(res.body.pricePerUnitInUsdCents, name).toBe("1.0000000000");
      expect(res.body.unit, name).toBe("USD cent");
    }
  });

  it("marks every line the listing serves as billable", async () => {
    const res = await request(app).get("/v1/platform-prices").set(identityHeaders);
    expect(res.status).toBe(200);
    for (const price of res.body) {
      expect(price.billable, price.name).toBe(true);
      expect(price.pricePerUnitInUsdCents, price.name).not.toBeNull();
    }
  });
});
