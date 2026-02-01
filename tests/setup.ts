import { beforeAll, afterAll } from "vitest";

process.env.COSTS_SERVICE_DATABASE_URL =
  process.env.COSTS_SERVICE_DATABASE_URL || "postgresql://test:test@localhost/test";
process.env.COSTS_SERVICE_API_KEY = "test-api-key";
process.env.NODE_ENV = "test";

beforeAll(() => console.log("Test suite starting..."));
afterAll(() => console.log("Test suite complete."));
