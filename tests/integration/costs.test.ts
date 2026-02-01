import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestCost, closeDb } from "../helpers/test-db.js";

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
    it("creates a new cost unit", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({ costPerUnitInUsdCents: "0.0003000000" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("test_cost");
      expect(res.body.costPerUnitInUsdCents).toBe("0.0003000000");
    });

    it("rejects without API key", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .send({ costPerUnitInUsdCents: "0.01" });

      expect(res.status).toBe(401);
    });

    it("rejects without costPerUnitInUsdCents", async () => {
      const res = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({});

      expect(res.status).toBe(400);
    });

    it("allows multiple price points for the same name", async () => {
      const res1 = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.01",
          effectiveFrom: "2025-01-01T00:00:00Z",
        });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .put("/v1/costs/test_cost")
        .set(authHeaders)
        .send({
          costPerUnitInUsdCents: "0.02",
          effectiveFrom: "2025-06-01T00:00:00Z",
        });
      expect(res2.status).toBe(200);

      // History should have 2 entries
      const history = await request(app).get("/v1/costs/test_cost/history");
      expect(history.body).toHaveLength(2);
    });
  });

  describe("GET /v1/costs/:name", () => {
    it("returns the latest effective price", async () => {
      await insertTestCost({
        name: "multi_price",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "multi_price",
        costPerUnitInUsdCents: "0.05",
        effectiveFrom: new Date("2025-06-01"),
      });
      // Future price — should not be returned
      await insertTestCost({
        name: "multi_price",
        costPerUnitInUsdCents: "0.99",
        effectiveFrom: new Date("2099-01-01"),
      });

      const res = await request(app).get("/v1/costs/multi_price");
      expect(res.status).toBe(200);
      expect(res.body.costPerUnitInUsdCents).toBe("0.0500000000");
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/costs/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /v1/costs", () => {
    it("returns current price per name", async () => {
      await insertTestCost({
        name: "alpha",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "alpha",
        costPerUnitInUsdCents: "0.02",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertTestCost({
        name: "beta",
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
  });

  describe("GET /v1/costs/:name/history", () => {
    it("returns all price points ordered by effective_from desc", async () => {
      await insertTestCost({
        name: "hist",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestCost({
        name: "hist",
        costPerUnitInUsdCents: "0.02",
        effectiveFrom: new Date("2025-06-01"),
      });
      await insertTestCost({
        name: "hist",
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

  describe("DELETE /v1/costs/:name", () => {
    it("deletes all entries for a name", async () => {
      await insertTestCost({ name: "to_delete", costPerUnitInUsdCents: "0.01" });
      await insertTestCost({
        name: "to_delete",
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
