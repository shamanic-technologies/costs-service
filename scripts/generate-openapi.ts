import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "../src/schemas.js";
import * as fs from "fs";

const generator = new OpenApiGeneratorV3(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Costs Service",
    description: "Cost tracking and budget management service",
    version: "1.0.0",
  },
  servers: [
    { url: process.env.COSTS_SERVICE_URL || "http://localhost:3011" },
  ],
});

fs.writeFileSync("openapi.json", JSON.stringify(document, null, 2));
console.log("[Costs Service] OpenAPI spec generated at openapi.json");
