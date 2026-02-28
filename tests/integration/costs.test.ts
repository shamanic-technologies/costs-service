import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestCost, insertPlatformPlan, closeDb } from "../helpers/test-db.js";

describe("Costs CRUD", () => {
  const app = createTestApp();
  const authHeaders = getAuthHeaders();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("PUT /v1/costs/:name", () => {
    it("creates a new cost unit with plan info", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.0003000000",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("test_cost");
      expect(res.body.provider).toBe("test-provider");
      expect(res.body.planTier).toBe("basic");
      expect(res.body.billingCycle).toBe("monthly");
      expect(res.body.costPerUnitInUsdCents).toBe("0.0003000000");
    });

    it("rejects without API key", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "test",
          planTier: "basic",
          billingCycle: "monthly",
        });

      expect(res.status).toBe(401);
    });

    it("rejects without costPerUnitInUsdCents", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({ provider: "test", planTier: "basic", billingCycle: "monthly" });

      expect(res.status).toBe(400);
    });

    it("rejects without provider", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({ costPerUnitInUsdCents: "0.01", planTier: "basic", billingCycle: "monthly" });

      expect(res.status).toBe(400);
    });

    it("rejects without planTier", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({ costPerUnitInUsdCents: "0.01", provider: "test", billingCycle: "monthly" });

      expect(res.status).toBe(400);
    });

    it("rejects without billingCycle", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({ costPerUnitInUsdCents: "0.01", provider: "test", planTier: "basic" });

      expect(res.status).toBe(400);
    });

    it("allows multiple price points for the same name and plan", async () => {
      const res1 = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
          effectiveFrom: "2025-01-01T00:00:00Z",
        });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.02",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
          effectiveFrom: "2025-06-01T00:00:00Z",
        });
      expect(res2.status).toBe(200);

      // History should have 2 entries
      const history = await request(app).get("/v1/costs/test_cost/history");
      expect(history.body).toHaveLength(2);
    });

    it("allows same name with different plans", async () => {
      const res1 = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
          effectiveFrom: "2025-01-01T00:00:00Z",
        });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.005",
          provider: "test-provider",
          planTier: "business",
          billingCycle: "monthly",
          effectiveFrom: "2025-01-01T00:00:00Z",
        });
      expect(res2.status).toBe(200);

      const history = await request(app).get("/v1/costs/test_cost/history");
      expect(history.body).toHaveLength(2);
    });
  });

  describe("GET /v1/costs/:name", () => {
    it("returns the cost resolved via platform plan", async () => {
      // Insert costs for two plans
      await insertTestCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "business",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.05",
        effectiveFrom: new Date("2025-01-01"),
      });

      // Set platform plan to basic
      await insertPlatformPlan({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/costs/multi_price");
      expect(res.status).toBe(200);
      expect(res.body.costPerUnitInUsdCents).toBe("0.1000000000");
      expect(res.body.planTier).toBe("basic");
    });

    it("returns the latest effective price for the active plan", async () => {
      await insertTestCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.05",
        effectiveFrom: new Date("2025-06-01"),
      });
      // Future price — should not be returned
      await insertTestCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.99",
        effectiveFrom: new Date("2099-01-01"),
      });

      await insertPlatformPlan({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/costs/multi_price");
      expect(res.status).toBe(200);
      expect(res.body.costPerUnitInUsdCents).toBe("0.0500000000");
    });

    it("returns correct cost after platform plan change", async () => {
      await insertTestCost({
        name: "switchable",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "switchable",
        provider: "test-provider",
        planTier: "business",
        billingCycle: "annual",
        costPerUnitInUsdCents: "0.03",
        effectiveFrom: new Date("2025-01-01"),
      });

      // Platform starts on basic/monthly, then switches to business/annual
      await insertPlatformPlan({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformPlan({
        provider: "test-provider",
        planTier: "business",
        billingCycle: "annual",
        effectiveFrom: new Date("2025-06-01"),
      });

      const res = await request(app).get("/v1/costs/switchable");
      expect(res.status).toBe(200);
      expect(res.body.costPerUnitInUsdCents).toBe("0.0300000000");
      expect(res.body.planTier).toBe("business");
      expect(res.body.billingCycle).toBe("annual");
    });

    it("returns 500 when no platform plan exists for provider", async () => {
      await insertTestCost({
        name: "orphan_cost",
        provider: "no-plan-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/costs/orphan_cost");
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("No platform plan configured");
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/costs/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns 404 when cost exists but not for the active plan", async () => {
      await insertTestCost({
        name: "wrong_plan",
        provider: "test-provider",
        planTier: "enterprise",
        billingCycle: "annual",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertPlatformPlan({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/costs/wrong_plan");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("basic/monthly");
    });
  });

  describe("GET /v1/costs", () => {
    it("returns current price per name resolved via platform plan", async () => {
      await insertPlatformPlan({
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformPlan({
        provider: "provider-b",
        planTier: "growth",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertTestCost({
        name: "alpha",
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "alpha",
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.02",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertTestCost({
        name: "beta",
        provider: "provider-b",
        planTier: "growth",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "1.00",
        effectiveFrom: new Date("2025-03-01"),
      });

      const res = await request(app).get("/v1/costs");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const alpha = res.body.find((c: any) => c.name === "alpha");
      const beta = res.body.find((c: any) => c.name === "beta");
      expect(alpha.costPerUnitInUsdCents).toBe("0.0200000000");
      expect(beta.costPerUnitInUsdCents).toBe("1.0000000000");
    });

    it("excludes costs whose provider has no platform plan", async () => {
      await insertPlatformPlan({
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertTestCost({
        name: "alpha",
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "orphan",
        provider: "no-plan",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.99",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/costs");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("alpha");
    });
  });

  describe("GET /v1/costs/:name/history", () => {
    it("returns all price points ordered by effective_from desc", async () => {
      await insertTestCost({
        name: "hist",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "hist",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.02",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertTestCost({
        name: "hist",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.03",
        effectiveFrom: new Date("2099-01-01"),
      });

      const res = await request(app).get("/v1/costs/hist/history");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      // Most recent first
      expect(res.body[0].costPerUnitInUsdCents).toBe("0.0300000000");
      expect(res.body[2].costPerUnitInUsdCents).toBe("0.0100000000");
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/costs/nonexistent/history");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /v1/costs/:name/plans", () => {
    it("returns all plan options for a cost", async () => {
      await insertTestCost({
        name: "multi_plan",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "multi_plan",
        provider: "test-provider",
        planTier: "business",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.05",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "multi_plan",
        provider: "test-provider",
        planTier: "business",
        billingCycle: "annual",
        costPerUnitInUsdCents: "0.03",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/costs/multi_plan/plans");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);

      const tiers = res.body.map((c: any) => `${c.planTier}/${c.billingCycle}`);
      expect(tiers).toContain("basic/monthly");
      expect(tiers).toContain("business/monthly");
      expect(tiers).toContain("business/annual");
    });

    it("returns latest effective price per plan option", async () => {
      await insertTestCost({
        name: "evolving",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "evolving",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.08",
        effectiveFrom: new Date("2025-06-01"),
      });

      const res = await request(app).get("/v1/costs/evolving/plans");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].costPerUnitInUsdCents).toBe("0.0800000000");
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/costs/nonexistent/plans");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /v1/costs/:name", () => {
    it("deletes all entries for a name", async () => {
      await insertTestCost({
        name: "to_delete",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
      });
      await insertTestCost({
        name: "to_delete",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.02",
        effectiveFrom: new Date("2025-06-01"),
      });

      const res = await request(app)
        .delete("/v1/costs/to_delete")
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);

      // Verify gone
      const check = await request(app).get("/v1/costs/to_delete");
      expect(check.status).toBe(404);
    });

    it("rejects without API key", async () => {
      const res = await request(app).delete("/v1/costs/test");
      expect(res.status).toBe(401);
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app)
        .delete("/v1/costs/nonexistent")
        .set(authHeaders);
      expect(res.status).toBe(404);
    });
  });
});
