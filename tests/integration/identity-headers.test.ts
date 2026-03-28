import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";

describe("Identity headers (x-org-id, x-user-id, x-run-id) requirement", () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  const protectedRoutes = [
    { method: "get" as const, path: "/v1/providers-costs" },
    { method: "get" as const, path: "/v1/providers-costs/some-name" },
    { method: "get" as const, path: "/v1/providers-costs/some-name/history" },
    { method: "get" as const, path: "/v1/providers-costs/some-name/plans" },
    { method: "get" as const, path: "/v1/platform-costs" },
    { method: "get" as const, path: "/v1/platform-costs/some-provider" },
    { method: "get" as const, path: "/v1/platform-costs/some-provider/history" },
    { method: "get" as const, path: "/v1/platform-prices" },
    { method: "get" as const, path: "/v1/platform-prices/some-name" },
  ];

  for (const { method, path } of protectedRoutes) {
    it(`rejects ${method.toUpperCase()} ${path} without identity headers`, async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("x-org-id");
      expect(res.body.error).toContain("x-user-id");
      expect(res.body.error).toContain("x-run-id");
    });
  }

  it("rejects when only x-org-id is provided", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set({ "x-org-id": identityHeaders["x-org-id"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-user-id");
    expect(res.body.error).toContain("x-run-id");
    expect(res.body.error).not.toContain("x-org-id");
  });

  it("rejects when only x-user-id is provided", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set({ "x-user-id": identityHeaders["x-user-id"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-org-id");
    expect(res.body.error).toContain("x-run-id");
    expect(res.body.error).not.toContain("x-user-id");
  });

  it("rejects when only x-run-id is provided", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set({ "x-run-id": identityHeaders["x-run-id"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-org-id");
    expect(res.body.error).toContain("x-user-id");
    expect(res.body.error).not.toContain("x-run-id");
  });

  it("rejects when x-run-id is missing but x-org-id and x-user-id are present", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set({ "x-org-id": identityHeaders["x-org-id"], "x-user-id": identityHeaders["x-user-id"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-run-id");
    expect(res.body.error).not.toContain("x-org-id");
    expect(res.body.error).not.toContain("x-user-id");
  });

  it("allows /health without identity headers", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("allows /openapi.json without identity headers", async () => {
    const res = await request(app).get("/openapi.json");
    // 200 if spec exists, 404 if not generated — but NOT 400
    expect(res.status).not.toBe(400);
  });

  it("passes through when all identity headers are present", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set(identityHeaders);
    // Should not be 400 (identity check passed). Could be 200 or other status depending on data.
    expect(res.status).not.toBe(400);
  });
});

describe("Workflow tracking headers (x-campaign-id, x-brand-id, x-workflow-slug, x-feature-slug) are optional", () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  it("accepts requests without workflow tracking headers", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set(identityHeaders);
    expect(res.status).not.toBe(400);
  });

  it("accepts requests with all workflow tracking headers", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set({
        ...identityHeaders,
        "x-campaign-id": "camp_abc123",
        "x-brand-id": "brand_xyz789",
        "x-workflow-slug": "lead-enrichment-v2",
        "x-feature-slug": "press-outreach",
      });
    expect(res.status).not.toBe(400);
  });

  it("accepts requests with only some workflow tracking headers", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set({
        ...identityHeaders,
        "x-campaign-id": "camp_abc123",
      });
    expect(res.status).not.toBe(400);
  });

  it("accepts requests with only x-feature-slug", async () => {
    const res = await request(app)
      .get("/v1/providers-costs")
      .set({
        ...identityHeaders,
        "x-feature-slug": "press-outreach",
      });
    expect(res.status).not.toBe(400);
  });

  it("documents workflow tracking headers in OpenAPI spec", async () => {
    const res = await request(app).get("/openapi.json");
    const spec = res.body;
    const params = spec.paths["/v1/providers-costs"]?.get?.parameters ?? [];
    const resolveParam = (p: { $ref?: string; name?: string; in?: string }) => {
      if (p.$ref) {
        const refName = p.$ref.replace("#/components/parameters/", "");
        return spec.components?.parameters?.[refName] ?? p;
      }
      return p;
    };
    const headerNames = params
      .map(resolveParam)
      .filter((p: { in: string }) => p.in === "header")
      .map((p: { name: string }) => p.name);
    expect(headerNames).toContain("x-campaign-id");
    expect(headerNames).toContain("x-brand-id");
    expect(headerNames).toContain("x-workflow-slug");
    expect(headerNames).toContain("x-feature-slug");
  });
});
