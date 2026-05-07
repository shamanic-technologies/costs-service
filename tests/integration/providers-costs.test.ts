import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost, insertPlatformCost, closeDb } from "../helpers/test-db.js";

describe("Providers Costs CRUD", () => {
  const app = createTestApp();
  const authHeaders = getAuthHeaders();
  const identityHeaders = getIdentityHeaders();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("PUT /v1/providers-costs/:name", () => {
    it("inserts a new price point for an existing cost", async () => {
      // Pre-seed the cost in the catalog
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.0001000000",
        effectiveFrom: new Date("2024-01-01"),
      });

      const res = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.0003000000",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
          type: "Input tokens",
          unit: "1M tokens",
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("test_cost");
      expect(res.body.provider).toBe("test-provider");
      expect(res.body.planTier).toBe("basic");
      expect(res.body.billingCycle).toBe("monthly");
      expect(res.body.costPerUnitInUsdCents).toBe("0.0003000000");
      expect(res.body.type).toBe("Input tokens");
      expect(res.body.unit).toBe("1M tokens");
      expect(res.body.providerDomain).toBeNull();
    });

    it("persists providerDomain when provided", async () => {
      await insertTestProviderCost({
        name: "test_cost_domain",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.0001000000",
        effectiveFrom: new Date("2024-01-01"),
      });

      const res = await request(app)
        .put("/v1/providers-costs/test_cost_domain")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.0003000000",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
          type: "Email send",
          unit: "email",
          providerDomain: "example.com",
        });

      expect(res.status).toBe(200);
      expect(res.body.providerDomain).toBe("example.com");
      expect(res.body.type).toBe("Email send");
      expect(res.body.unit).toBe("email");
    });

    it("rejects without type", async () => {
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
      });

      const res = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "test",
          planTier: "basic",
          billingCycle: "monthly",
          unit: "email",
        });

      expect(res.status).toBe(400);
    });

    it("rejects without unit", async () => {
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
      });

      const res = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "test",
          planTier: "basic",
          billingCycle: "monthly",
          type: "Email send",
        });

      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown cost name not in catalog", async () => {
      const res = await request(app)
        .put("/v1/providers-costs/nonexistent-cost-xyz")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "fake-provider",
          planTier: "basic",
          billingCycle: "monthly",
          type: "Test type",
          unit: "test-unit",
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Unknown cost name");
      expect(res.body.error).toContain("nonexistent-cost-xyz");
    });

    it("rejects without API key", async () => {
      const res = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(identityHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "test",
          planTier: "basic",
          billingCycle: "monthly",
        });

      expect(res.status).toBe(401);
    });

    it("rejects without costPerUnitInUsdCents", async () => {
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
      });

      const res = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({ provider: "test", planTier: "basic", billingCycle: "monthly" });

      expect(res.status).toBe(400);
    });

    it("rejects without provider", async () => {
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
      });

      const res = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({ costPerUnitInUsdCents: "0.01", planTier: "basic", billingCycle: "monthly" });

      expect(res.status).toBe(400);
    });

    it("rejects without planTier", async () => {
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
      });

      const res = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({ costPerUnitInUsdCents: "0.01", provider: "test", billingCycle: "monthly" });

      expect(res.status).toBe(400);
    });

    it("rejects without billingCycle", async () => {
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
      });

      const res = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({ costPerUnitInUsdCents: "0.01", provider: "test", planTier: "basic" });

      expect(res.status).toBe(400);
    });

    it("allows multiple price points for the same name and plan", async () => {
      // Pre-seed the cost
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.001",
        effectiveFrom: new Date("2023-01-01"),
      });

      const res1 = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
          type: "Test type",
          unit: "test-unit",
          effectiveFrom: "2025-01-01T00:00:00Z",
        });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.02",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
          type: "Test type",
          unit: "test-unit",
          effectiveFrom: "2025-06-01T00:00:00Z",
        });
      expect(res2.status).toBe(200);

      // History should have 3 entries (1 seed + 2 via PUT)
      const history = await request(app).get("/v1/providers-costs/test_cost/history").set(identityHeaders);
      expect(history.body).toHaveLength(3);
    });

    it("allows same name with different plans", async () => {
      // Pre-seed the cost
      await insertTestProviderCost({
        name: "test_cost",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.001",
        effectiveFrom: new Date("2023-01-01"),
      });

      const res1 = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          provider: "test-provider",
          planTier: "basic",
          billingCycle: "monthly",
          type: "Test type",
          unit: "test-unit",
          effectiveFrom: "2025-01-01T00:00:00Z",
        });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .put("/v1/providers-costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.005",
          provider: "test-provider",
          planTier: "business",
          billingCycle: "monthly",
          type: "Test type",
          unit: "test-unit",
          effectiveFrom: "2025-01-01T00:00:00Z",
        });
      expect(res2.status).toBe(200);

      const history = await request(app).get("/v1/providers-costs/test_cost/history").set(identityHeaders);
      expect(history.body).toHaveLength(3);
    });
  });

  describe("New metadata fields exposed by GET endpoints", () => {
    it("GET /v1/providers-costs/:name returns provider, providerDomain, type, unit", async () => {
      await insertTestProviderCost({
        name: "meta_cost",
        provider: "meta-provider",
        providerDomain: "meta.example",
        type: "Search query",
        unit: "query",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformCost({
        provider: "meta-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs/meta_cost").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe("meta-provider");
      expect(res.body.providerDomain).toBe("meta.example");
      expect(res.body.type).toBe("Search query");
      expect(res.body.unit).toBe("query");
    });

    it("GET /v1/providers-costs (list) returns new fields per row", async () => {
      await insertPlatformCost({
        provider: "p1",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "list_cost",
        provider: "p1",
        providerDomain: "p1.example",
        type: "Output tokens",
        unit: "1M tokens",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs").set(identityHeaders);
      expect(res.status).toBe(200);
      const row = res.body.find((c: any) => c.name === "list_cost");
      expect(row.provider).toBe("p1");
      expect(row.providerDomain).toBe("p1.example");
      expect(row.type).toBe("Output tokens");
      expect(row.unit).toBe("1M tokens");
    });

    it("GET /v1/providers-costs/:name/history returns new fields per row", async () => {
      await insertTestProviderCost({
        name: "hist_meta",
        provider: "p2",
        providerDomain: "p2.example",
        type: "Credit",
        unit: "credit",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs/hist_meta/history").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body[0].providerDomain).toBe("p2.example");
      expect(res.body[0].type).toBe("Credit");
      expect(res.body[0].unit).toBe("credit");
    });

    it("GET /v1/providers-costs/:name/plans returns new fields per row", async () => {
      await insertTestProviderCost({
        name: "plans_meta",
        provider: "p3",
        providerDomain: "p3.example",
        type: "SMS message",
        unit: "segment",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs/plans_meta/plans").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body[0].providerDomain).toBe("p3.example");
      expect(res.body[0].type).toBe("SMS message");
      expect(res.body[0].unit).toBe("segment");
    });
  });

  describe("GET /v1/providers-costs/:name", () => {
    it("returns the cost resolved via platform plan", async () => {
      await insertTestProviderCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "business",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.05",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertPlatformCost({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs/multi_price").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body.costPerUnitInUsdCents).toBe("0.1000000000");
      expect(res.body.planTier).toBe("basic");
    });

    it("returns the latest effective price for the active plan", async () => {
      await insertTestProviderCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.05",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertTestProviderCost({
        name: "multi_price",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.99",
        effectiveFrom: new Date("2099-01-01"),
      });

      await insertPlatformCost({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs/multi_price").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body.costPerUnitInUsdCents).toBe("0.0500000000");
    });

    it("returns correct cost after platform plan change", async () => {
      await insertTestProviderCost({
        name: "switchable",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "switchable",
        provider: "test-provider",
        planTier: "business",
        billingCycle: "annual",
        costPerUnitInUsdCents: "0.03",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertPlatformCost({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformCost({
        provider: "test-provider",
        planTier: "business",
        billingCycle: "annual",
        effectiveFrom: new Date("2025-06-01"),
      });

      const res = await request(app).get("/v1/providers-costs/switchable").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body.costPerUnitInUsdCents).toBe("0.0300000000");
      expect(res.body.planTier).toBe("business");
      expect(res.body.billingCycle).toBe("annual");
    });

    it("returns 500 when no platform plan exists for provider", async () => {
      await insertTestProviderCost({
        name: "orphan_cost",
        provider: "no-plan-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs/orphan_cost").set(identityHeaders);
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("No platform cost configured");
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/providers-costs/nonexistent").set(identityHeaders);
      expect(res.status).toBe(404);
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

      const res = await request(app).get("/v1/providers-costs/wrong_plan").set(identityHeaders);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("basic/monthly");
    });
  });

  describe("GET /v1/providers-costs", () => {
    it("returns current price per name resolved via platform plan", async () => {
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
        name: "alpha",
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.02",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertTestProviderCost({
        name: "beta",
        provider: "provider-b",
        planTier: "growth",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "1.00",
        effectiveFrom: new Date("2025-03-01"),
      });

      const res = await request(app).get("/v1/providers-costs").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const alpha = res.body.find((c: any) => c.name === "alpha");
      const beta = res.body.find((c: any) => c.name === "beta");
      expect(alpha.costPerUnitInUsdCents).toBe("0.0200000000");
      expect(beta.costPerUnitInUsdCents).toBe("1.0000000000");
    });

    it("excludes costs whose provider has no platform plan", async () => {
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

      const res = await request(app).get("/v1/providers-costs").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("alpha");
    });
  });

  describe("GET /v1/providers-costs/:name/history", () => {
    it("returns all price points ordered by effective_from desc", async () => {
      await insertTestProviderCost({
        name: "hist",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "hist",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.02",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertTestProviderCost({
        name: "hist",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.03",
        effectiveFrom: new Date("2099-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs/hist/history").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].costPerUnitInUsdCents).toBe("0.0300000000");
      expect(res.body[2].costPerUnitInUsdCents).toBe("0.0100000000");
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/providers-costs/nonexistent/history").set(identityHeaders);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /v1/providers-costs/:name/plans", () => {
    it("returns all plan options for a cost", async () => {
      await insertTestProviderCost({
        name: "multi_plan",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "multi_plan",
        provider: "test-provider",
        planTier: "business",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.05",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "multi_plan",
        provider: "test-provider",
        planTier: "business",
        billingCycle: "annual",
        costPerUnitInUsdCents: "0.03",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/providers-costs/multi_plan/plans").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);

      const tiers = res.body.map((c: any) => `${c.planTier}/${c.billingCycle}`);
      expect(tiers).toContain("basic/monthly");
      expect(tiers).toContain("business/monthly");
      expect(tiers).toContain("business/annual");
    });

    it("returns latest effective price per plan option", async () => {
      await insertTestProviderCost({
        name: "evolving",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.10",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "evolving",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.08",
        effectiveFrom: new Date("2025-06-01"),
      });

      const res = await request(app).get("/v1/providers-costs/evolving/plans").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].costPerUnitInUsdCents).toBe("0.0800000000");
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/providers-costs/nonexistent/plans").set(identityHeaders);
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /v1/providers-costs/:name", () => {
    it("deletes all entries for a name", async () => {
      await insertTestProviderCost({
        name: "to_delete",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
      });
      await insertTestProviderCost({
        name: "to_delete",
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.02",
        effectiveFrom: new Date("2025-06-01"),
      });

      const res = await request(app)
        .delete("/v1/providers-costs/to_delete")
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);

      // Verify gone
      const check = await request(app).get("/v1/providers-costs/to_delete").set(identityHeaders);
      expect(check.status).toBe(404);
    });

    it("rejects without API key", async () => {
      const res = await request(app).delete("/v1/providers-costs/test").set(identityHeaders);
      expect(res.status).toBe(401);
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app)
        .delete("/v1/providers-costs/nonexistent")
        .set(authHeaders);
      expect(res.status).toBe(404);
    });
  });
});
