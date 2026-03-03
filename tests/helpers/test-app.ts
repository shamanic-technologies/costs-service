import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import healthRoutes from "../../src/routes/health.js";
import providersCostsRoutes from "../../src/routes/providers-costs.js";
import platformCostsRoutes from "../../src/routes/platform-costs.js";
import platformPricesRoutes from "../../src/routes/platform-prices.js";
import { requireIdentityHeaders } from "../../src/middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openapiPath = path.resolve(__dirname, "../../openapi.json");

export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(requireIdentityHeaders);
  app.get("/openapi.json", (_req, res) => {
    if (existsSync(openapiPath)) {
      res.json(JSON.parse(readFileSync(openapiPath, "utf-8")));
    } else {
      res.status(404).json({ error: "OpenAPI spec not found. Run: npm run generate:openapi" });
    }
  });
  app.use(healthRoutes);
  app.use(providersCostsRoutes);
  app.use(platformCostsRoutes);
  app.use(platformPricesRoutes);
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

export const TEST_ORG_ID = "00000000-0000-0000-0000-000000000001";
export const TEST_USER_ID = "00000000-0000-0000-0000-000000000002";
export const TEST_RUN_ID = "00000000-0000-0000-0000-000000000003";

export function getAuthHeaders() {
  return {
    "X-API-Key": "test-api-key",
    "Content-Type": "application/json",
    "x-org-id": TEST_ORG_ID,
    "x-user-id": TEST_USER_ID,
    "x-run-id": TEST_RUN_ID,
  };
}

export function getIdentityHeaders() {
  return {
    "x-org-id": TEST_ORG_ID,
    "x-user-id": TEST_USER_ID,
    "x-run-id": TEST_RUN_ID,
  };
}
