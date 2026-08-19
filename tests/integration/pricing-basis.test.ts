import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, closeDb, insertTestProviderCost, insertPlatformCost } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";
import { sql } from "../../src/db/index.js";

// A public price read must let the landing page print, per line, both the price and whether
// that line carries a markup — without the page hardcoding which names are which.
describe("pricing basis on the public price read", { timeout: 60_000 }, () => {
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

  const ADVERTISING_CHANNELS: { name: string; provider: string; domain: string | null }[] = [
    { name: "google-ads-spend", provider: "google-ads", domain: "ads.google.com" },
    { name: "meta-ads-spend", provider: "meta-ads", domain: "facebook.com" },
    { name: "linkedin-ads-spend", provider: "linkedin-ads", domain: "linkedin.com" },
    { name: "tiktok-ads-spend", provider: "tiktok-ads", domain: "tiktok.com" },
    { name: "youtube-ads-spend", provider: "youtube-ads", domain: "youtube.com" },
    { name: "x-ads-spend", provider: "x-ads", domain: "x.com" },
    { name: "reddit-ads-spend", provider: "reddit-ads", domain: "reddit.com" },
    { name: "bing-ads-spend", provider: "bing-ads", domain: "bing.com" },
    { name: "quora-ads-spend", provider: "quora-ads", domain: "quora.com" },
    { name: "newsletter-sponsorship-spend", provider: "newsletter-sponsorship", domain: null },
    { name: "podcast-sponsorship-spend", provider: "podcast-sponsorship", domain: null },
    { name: "creator-sponsorship-spend", provider: "creator-sponsorship", domain: null },
    { name: "software-directory-listing-spend", provider: "software-directory-listing", domain: null },
  ];

  for (const channel of ADVERTISING_CHANNELS) {
    it(`GET /v1/platform-prices/${channel.name} serves the vendor price with no markup`, async () => {
      const res = await request(app).get(`/v1/platform-prices/${channel.name}`).set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body.pricePerUnitInUsdCents).toBe("1.0000000000");
      expect(res.body.pricingBasis).toBe("pass-through");
      expect(res.body.unit).toBe("USD cent");
      expect(res.body.provider).toBe(channel.provider);
      expect(res.body.providerDomain).toBe(channel.domain);
    });
  }

  it("a payment-processing line reads back at the Stripe fee exactly", async () => {
    const res = await request(app).get("/v1/platform-prices/stripe-processing-fee").set(identityHeaders);
    expect(res.status).toBe(200);
    expect(res.body.pricePerUnitInUsdCents).toBe("1.0000000000");
    expect(res.body.pricingBasis).toBe("pass-through");
  });

  it("an LLM line is unchanged and says it carries a markup", async () => {
    const res = await request(app).get("/v1/platform-prices/anthropic-web-search").set(identityHeaders);
    expect(res.status).toBe(200);
    expect(res.body.pricePerUnitInUsdCents).toBe("4.0000000000");
    expect(res.body.pricingBasis).toBe("marked-up");
  });

  it("the list read classifies every line it serves", async () => {
    const res = await request(app).get("/v1/platform-prices").set(identityHeaders);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(50);
    for (const price of res.body) {
      expect(["marked-up", "pass-through"], `${price.name}`).toContain(price.pricingBasis);
    }
    const byName = new Map(res.body.map((p: any) => [p.name, p]));
    expect((byName.get("google-ads-spend") as any).pricingBasis).toBe("pass-through");
    expect((byName.get("google-embedding-001-tokens-input") as any).pricingBasis).toBe("marked-up");
  });

  it("GET /v1/providers-costs/:name carries the basis too", async () => {
    const res = await request(app).get("/v1/providers-costs/meta-ads-spend").set(identityHeaders);
    expect(res.status).toBe(200);
    expect(res.body.pricingBasis).toBe("pass-through");
  });

  it("refuses to serve a line whose class cannot be resolved (no silent default)", async () => {
    await cleanTestData();
    await insertPlatformCost({ provider: "mystery", planTier: "pay-as-you-go", billingCycle: "monthly" });
    const cost = await insertTestProviderCost({
      name: "mystery-line",
      provider: "mystery",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "1.0000000000",
    });
    // Bypass every write-side guard the way a hand-written row would.
    await sql`UPDATE providers_costs SET pricing_basis = 'freebie' WHERE id = ${cost.id}`;

    const res = await request(app).get("/v1/platform-prices/mystery-line").set(identityHeaders);
    expect(res.status).toBe(500);
  });
});

// Same file, separate block: closeDb() tears down the shared pool, so only the LAST block in
// the file may call it.
describe("pricing basis on write", { timeout: 60_000 }, () => {
  const app = createTestApp();
  const authHeaders = { "x-api-key": process.env.COSTS_SERVICE_API_KEY || "test-api-key", ...getIdentityHeaders() };

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("rejects a new price point that does not state its class", async () => {
    await insertTestProviderCost({
      name: "basis-required",
      provider: "test-provider",
      planTier: "basic",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "0.0001000000",
    });

    const res = await request(app)
      .put("/v1/providers-costs/basis-required")
      .set(authHeaders)
      .send({
        costPerUnitInUsdCents: "0.0003000000",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        type: "Input tokens",
        unit: "1M tokens",
      });

    expect(res.status).toBe(400);
  });

  it("stores a pass-through price point as written", async () => {
    await insertTestProviderCost({
      name: "basis-write",
      provider: "test-provider",
      planTier: "basic",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "0.0001000000",
    });

    const res = await request(app)
      .put("/v1/providers-costs/basis-write")
      .set(authHeaders)
      .send({
        costPerUnitInUsdCents: "1.0000000000",
        pricingBasis: "pass-through",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        type: "Ad platform spend",
        unit: "USD cent",
      });

    expect(res.status).toBe(200);
    expect(res.body.pricingBasis).toBe("pass-through");
  });
});
