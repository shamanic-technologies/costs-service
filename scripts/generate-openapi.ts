import swaggerAutogen from "swagger-autogen";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const doc = {
  info: {
    version: "1.0.0",
    title: "Costs Service",
    description: "API for managing unit cost pricing",
  },
  host: process.env.SERVICE_URL?.replace(/^https?:\/\//, "") || "localhost:3011",
  basePath: "/",
  schemes: process.env.SERVICE_URL?.startsWith("https") ? ["https"] : ["http"],
};

const outputFile = path.resolve(__dirname, "../openapi.json");
const routes = [
  path.resolve(__dirname, "../src/routes/health.ts"),
  path.resolve(__dirname, "../src/routes/costs.ts"),
];

swaggerAutogen({ openapi: "3.0.0" })(outputFile, routes, doc).then(() => {
  console.log("[Costs Service] OpenAPI spec generated at openapi.json");
});
