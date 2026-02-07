import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import healthRoutes from "../../src/routes/health.js";
import costsRoutes from "../../src/routes/costs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openapiPath = path.resolve(__dirname, "../../openapi.json");

export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get("/openapi.json", (_req, res) => {
    if (existsSync(openapiPath)) {
      res.json(JSON.parse(readFileSync(openapiPath, "utf-8")));
    } else {
      res.status(404).json({ error: "OpenAPI spec not found. Run: npm run generate:openapi" });
    }
  });
  app.use(healthRoutes);
  app.use(costsRoutes);
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

export function getAuthHeaders() {
  return {
    "X-API-Key": "test-api-key",
    "Content-Type": "application/json",
  };
}
