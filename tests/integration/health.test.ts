import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";

describe("Health endpoint", () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  it("GET /health returns 200", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "costs-service" });
  });

  it("GET /nonexistent returns 404 with identity headers", async () => {
    const response = await request(app).get("/nonexistent").set(identityHeaders);
    expect(response.status).toBe(404);
  });

  it("GET /nonexistent returns 400 without identity headers", async () => {
    const response = await request(app).get("/nonexistent");
    expect(response.status).toBe(400);
  });
});
