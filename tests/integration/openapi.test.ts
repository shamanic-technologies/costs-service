import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";

describe("OpenAPI endpoint", () => {
  const app = createTestApp();

  it("GET /openapi.json returns valid OpenAPI 3.0 spec", async () => {
    const response = await request(app).get("/openapi.json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe("3.0.0");
    expect(response.body.info.title).toBe("Costs Service");
    expect(response.body.info.version).toBe("1.0.0");
    expect(response.body.paths).toBeDefined();
  });

  it("GET /openapi.json is served without authentication", async () => {
    const response = await request(app).get("/openapi.json");
    expect(response.status).toBe(200);
  });
});
