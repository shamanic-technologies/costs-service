import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";

// Stripe payment-processing fees: stripe-service emits a runs-service cost write per
// Stripe-incurred fee event (charge processing, refund, dispute, payout failure).
// Quantity = fee in cents; unit price = "1.0000000000", i.e. one cent per cent of Stripe fee.
// These are PASS-THROUGH lines (no markup). Since 2026-10-13 no org pays them: they are the
// platform's cost, declared on org-less platform runs, and left out of the current catalogue
// listings (tests/integration/card-fees-absorbed.test.ts). The by-name price stays as written
// because runs-service prices every fee cost row from it.
describe("Stripe fee cost names", { timeout: 30_000 }, () => {
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

  const STRIPE_COST_NAMES = [
    { name: "stripe-processing-fee", type: "Charge processing fee" },
    { name: "stripe-refund-fee", type: "Refund fee" },
    { name: "stripe-dispute-fee", type: "Dispute fee" },
    { name: "stripe-payout-failure-fee", type: "Payout failure fee" },
  ];

  for (const { name, type } of STRIPE_COST_NAMES) {
    it(`GET /v1/platform-prices/${name} resolves at the vendor price, no markup`, async () => {
      const res = await request(app).get(`/v1/platform-prices/${name}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(name);
      expect(res.body.pricePerUnitInUsdCents).toBe("1.0000000000");
      expect(res.body.pricingBasis).toBe("pass-through");
      expect(res.body.unit).toBe("USD cent");
      expect(res.body.provider).toBe("stripe");
      expect(res.body.providerDomain).toBe("stripe.com");
      expect(res.body.type).toBe(type);
    });
  }

  // Revolut Merchant, our second acquirer: same pass-through basis as the Stripe processing fee.
  it("GET /v1/platform-prices/revolut-acquiring-fee resolves at the vendor price, no markup", async () => {
    const res = await request(app).get("/v1/platform-prices/revolut-acquiring-fee");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("revolut-acquiring-fee");
    expect(res.body.pricePerUnitInUsdCents).toBe("1.0000000000");
    expect(res.body.pricingBasis).toBe("pass-through");
    expect(res.body.unit).toBe("USD cent");
    expect(res.body.provider).toBe("revolut");
    expect(res.body.providerDomain).toBe("revolut.com");
    expect(res.body.type).toBe("Card acquiring fee");
  });

  it("GET /v1/platform-costs/stripe returns pay-as-you-go / monthly", async () => {
    const res = await request(app).get("/v1/platform-costs/stripe").set(identityHeaders);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("stripe");
    expect(res.body.planTier).toBe("pay-as-you-go");
    expect(res.body.billingCycle).toBe("monthly");
  });
});
