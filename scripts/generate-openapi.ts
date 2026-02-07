import swaggerAutogen from "swagger-autogen";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const doc = {
  info: {
    title: "Costs Service",
    description: "Cost tracking and budget management service",
    version: "1.0.0",
  },
  host: process.env.COSTS_SERVICE_URL || "http://localhost:3011",
  basePath: "/",
  schemes: ["https"],
};

const outputFile = path.resolve(__dirname, "../openapi.json");
const routes = [
  path.resolve(__dirname, "../src/routes/health.ts"),
  path.resolve(__dirname, "../src/routes/costs.ts"),
];

swaggerAutogen({ openapi: "3.0.0" })(outputFile, routes, doc).then(() => {
  console.log("[Costs Service] OpenAPI spec generated at openapi.json");
});
