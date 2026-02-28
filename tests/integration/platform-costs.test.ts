import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertPlatformCost, closeDb } from "../helpers/test-db.js";

describe("Platform Costs CRUD", () => {
  const app = createTestApp();
  const authHeaders = getAuthHeaders();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("PUT /v1/platform-costs/:provider", () => {
    it("creates a new platform cost", async () => {
      const res = await request(app)
        .put("/v1/platform-costs/apollo")
        .set(authHeaders)
        .send({
          planTier: "business",
          billingCycle: "annual",
          effectiveFrom: "2026-01-01T00:00:00Z",
        });

      expect(res.status).toBe(200);
      expect(res.body.provider).toBe("apollo");
      expect(res.body.planTier).toBe("business");
      expect(res.body.billingCycle).toBe("annual");
    });

    it("rejects without API key", async () => {
      const res = await request(app)
        .put("/v1/platform-costs/apollo")
        .send({ planTier: "basic", billingCycle: "monthly" });

      expect(res.status).toBe(401);
    });

    it("rejects without planTier", async () => {
      const res = await request(app)
        .put("/v1/platform-costs/apollo")
        .set(authHeaders)
        .send({ billingCycle: "monthly" });

      expect(res.status).toBe(400);
    });

    it("rejects without billingCycle", async () => {
      const res = await request(app)
        .put("/v1/platform-costs/apollo")
        .set(authHeaders)
        .send({ planTier: "basic" });

      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate provider + effectiveFrom", async () => {
      await insertPlatformCost({
        provider: "apollo",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app)
        .put("/v1/platform-costs/apollo")
        .set(authHeaders)
        .send({
          planTier: "business",
          billingCycle: "annual",
          effectiveFrom: "2025-01-01T00:00:00Z",
        });

      expect(res.status).toBe(409);
    });

    it("defaults effectiveFrom to now if omitted", async () => {
      const res = await request(app)
        .put("/v1/platform-costs/apollo")
        .set(authHeaders)
        .send({ planTier: "basic", billingCycle: "monthly" });

      expect(res.status).toBe(200);
      expect(res.body.effectiveFrom).toBeDefined();
    });
  });

  describe("GET /v1/platform-costs", () => {
    it("returns current cost config per provider", async () => {
      await insertPlatformCost({
        provider: "apollo",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformCost({
        provider: "apollo",
        planTier: "business",
        billingCycle: "annual",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertPlatformCost({
        provider: "firecrawl",
        planTier: "hobby",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-costs");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const apollo = res.body.find((p: any) => p.provider === "apollo");
      const firecrawl = res.body.find((p: any) => p.provider === "firecrawl");
      expect(apollo.planTier).toBe("business");
      expect(apollo.billingCycle).toBe("annual");
      expect(firecrawl.planTier).toBe("hobby");
    });

    it("excludes future entries", async () => {
      await insertPlatformCost({
        provider: "apollo",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformCost({
        provider: "apollo",
        planTier: "enterprise",
        billingCycle: "annual",
        effectiveFrom: new Date("2099-01-01"),
      });

      const res = await request(app).get("/v1/platform-costs");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].planTier).toBe("basic");
    });
  });

  describe("GET /v1/platform-costs/:provider", () => {
    it("returns current cost config for a provider", async () => {
      await insertPlatformCost({
        provider: "apollo",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-costs/apollo");
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe("apollo");
      expect(res.body.planTier).toBe("basic");
      expect(res.body.billingCycle).toBe("monthly");
    });

    it("returns 404 for unknown provider", async () => {
      const res = await request(app).get("/v1/platform-costs/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /v1/platform-costs/:provider/history", () => {
    it("returns all changes ordered by effective_from desc", async () => {
      await insertPlatformCost({
        provider: "apollo",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformCost({
        provider: "apollo",
        planTier: "business",
        billingCycle: "annual",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertPlatformCost({
        provider: "apollo",
        planTier: "enterprise",
        billingCycle: "annual",
        effectiveFrom: new Date("2026-01-01"),
      });

      const res = await request(app).get("/v1/platform-costs/apollo/history");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].planTier).toBe("enterprise");
      expect(res.body[1].planTier).toBe("business");
      expect(res.body[2].planTier).toBe("basic");
    });

    it("returns 404 for unknown provider", async () => {
      const res = await request(app).get("/v1/platform-costs/nonexistent/history");
      expect(res.status).toBe(404);
    });
  });
});
