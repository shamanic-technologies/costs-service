import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost, insertPlatformCost, closeDb } from "../helpers/test-db.js";

describe("Platform Prices (consumer-facing)", () => {
  const app = createTestApp();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /v1/platform-prices/:name", () => {
    it("returns the price resolved via platform cost config", async () => {
      await insertTestProviderCost({
        name: "test-token-input",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.0003",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertPlatformCost({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices/test-token-input");
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("test-token-input");
      expect(res.body.pricePerUnitInUsdCents).toBe("0.0003000000");
      expect(res.body.provider).toBe("test-provider");
      expect(res.body.effectiveFrom).toBeDefined();
      // Should NOT expose plan details
      expect(res.body.planTier).toBeUndefined();
      expect(res.body.billingCycle).toBeUndefined();
      expect(res.body.id).toBeUndefined();
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/platform-prices/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns 500 when no platform cost exists for provider", async () => {
      await insertTestProviderCost({
        name: "orphan",
        provider: "no-plan-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices/orphan");
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("No platform cost configured");
    });

    it("returns 404 when cost exists but not for the active plan", async () => {
      await insertTestProviderCost({
        name: "wrong_plan",
        provider: "test-provider",
        planTier: "enterprise",
        billingCycle: "annual",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertPlatformCost({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices/wrong_plan");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("basic/monthly");
    });
  });

  describe("GET /v1/platform-prices", () => {
    it("returns current prices for all cost names", async () => {
      await insertPlatformCost({
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformCost({
        provider: "provider-b",
        planTier: "growth",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertTestProviderCost({
        name: "alpha",
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "beta",
        provider: "provider-b",
        planTier: "growth",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "1.00",
        effectiveFrom: new Date("2025-03-01"),
      });

      const res = await request(app).get("/v1/platform-prices");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const alpha = res.body.find((p: any) => p.name === "alpha");
      const beta = res.body.find((p: any) => p.name === "beta");
      expect(alpha.pricePerUnitInUsdCents).toBe("0.0100000000");
      expect(beta.pricePerUnitInUsdCents).toBe("1.0000000000");
      // Should NOT expose plan details
      expect(alpha.planTier).toBeUndefined();
      expect(alpha.billingCycle).toBeUndefined();
    });

    it("excludes costs whose provider has no platform cost config", async () => {
      await insertPlatformCost({
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertTestProviderCost({
        name: "alpha",
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "orphan",
        provider: "no-plan",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.99",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("alpha");
    });

    it("does not require auth (consumer-facing)", async () => {
      const res = await request(app).get("/v1/platform-prices");
      expect(res.status).toBe(200);
    });
  });
});
