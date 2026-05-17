import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";

// Stripe pass-through fees: stripe-service emits a runs-service cost write per
// Stripe-incurred fee event (charge processing, refund, dispute, payout failure).
// Quantity = fee in cents; unit price = 1 cent base × COST_RISK_MULTIPLIER (=2)
// = "2.0000000000". Org is charged 2× the actual Stripe fee, matching the
// platform-wide cost-risk markup convention.
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
    it(`GET /v1/platform-prices/${name} resolves at 2¢/USD-cent`, async () => {
      const res = await request(app).get(`/v1/platform-prices/${name}`).set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(name);
      expect(res.body.pricePerUnitInUsdCents).toBe("2.0000000000");
      expect(res.body.unit).toBe("USD cent");
      expect(res.body.provider).toBe("stripe");
      expect(res.body.providerDomain).toBe("stripe.com");
      expect(res.body.type).toBe(type);
    });
  }

  it("GET /v1/platform-costs/stripe returns pay-as-you-go / monthly", async () => {
    const res = await request(app).get("/v1/platform-costs/stripe").set(identityHeaders);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("stripe");
    expect(res.body.planTier).toBe("pay-as-you-go");
    expect(res.body.billingCycle).toBe("monthly");
  });
});
