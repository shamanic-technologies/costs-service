import { z } from "zod";
import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// --- Shared schemas ---

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .openapi("ErrorResponse");

export const ValidationErrorResponseSchema = z
  .object({
    error: z.string(),
    details: z.object({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string())),
    }).optional(),
  })
  .openapi("ValidationErrorResponse");

export const CostUnitSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    provider: z.string(),
    planTier: z.string(),
    billingCycle: z.string(),
    costPerUnitInUsdCents: z.string(),
    effectiveFrom: z.string().datetime(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("CostUnit");

export const PlatformPlanSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.string(),
    planTier: z.string(),
    billingCycle: z.string(),
    effectiveFrom: z.string().datetime(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("PlatformPlan");

// --- PUT /v1/costs/:name ---

export const PutCostBodySchema = z
  .object({
    costPerUnitInUsdCents: z.union([z.string(), z.number()]),
    provider: z.string(),
    planTier: z.string(),
    billingCycle: z.string(),
    effectiveFrom: z.string().datetime().optional(),
  })
  .openapi("PutCostBody");

// --- PUT /v1/platform-plans/:provider ---

export const PutPlatformPlanBodySchema = z
  .object({
    planTier: z.string(),
    billingCycle: z.string(),
    effectiveFrom: z.string().datetime().optional(),
  })
  .openapi("PutPlatformPlanBody");

// --- DELETE /v1/costs/:name ---

export const DeleteCostResponseSchema = z
  .object({
    deleted: z.number(),
  })
  .openapi("DeleteCostResponse");

// --- Health ---

export const HealthResponseSchema = z
  .object({
    status: z.string(),
    service: z.string(),
  })
  .openapi("HealthResponse");

// --- Path parameters ---

const CostNameParam = registry.registerParameter(
  "CostName",
  z.string().openapi({
    param: { name: "name", in: "path" },
    description: "Cost unit identifier ({provider}-{service-or-model}-{unit-type})",
    example: "anthropic-sonnet-4.5-tokens-input",
  })
);

const ProviderParam = registry.registerParameter(
  "Provider",
  z.string().openapi({
    param: { name: "provider", in: "path" },
    description: "Provider identifier (e.g. apollo, anthropic, firecrawl)",
    example: "apollo",
  })
);

// --- Register paths ---

registry.registerPath({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  summary: "Health check",
  responses: {
    200: {
      description: "Service is healthy",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs",
  operationId: "listCosts",
  summary: "List all current prices (resolved via platform plan per provider)",
  responses: {
    200: {
      description: "List of current cost units",
      content: { "application/json": { schema: z.array(CostUnitSchema) } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/{name}",
  operationId: "getCost",
  summary: "Get current price for a cost unit (resolved via platform plan)",
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "Current cost unit",
      content: { "application/json": { schema: CostUnitSchema } },
    },
    404: {
      description: "Cost unit not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error (e.g. no platform plan configured)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/{name}/history",
  operationId: "getCostHistory",
  summary: "Get all price points for a cost unit",
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "Price history",
      content: { "application/json": { schema: z.array(CostUnitSchema) } },
    },
    404: {
      description: "Cost unit not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/{name}/plans",
  operationId: "getCostPlans",
  summary: "List all known plan options for a cost unit",
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "All plan/billing cycle combinations for this cost",
      content: { "application/json": { schema: z.array(CostUnitSchema) } },
    },
    404: {
      description: "Cost unit not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/costs/{name}",
  operationId: "putCost",
  summary: "Insert a new price point for a cost unit",
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({ name: CostNameParam }),
    body: {
      required: true,
      content: { "application/json": { schema: PutCostBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Inserted cost unit",
      content: { "application/json": { schema: CostUnitSchema } },
    },
    400: {
      description: "Invalid request body",
      content: { "application/json": { schema: ValidationErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Duplicate cost unit (name + plan_tier + billing_cycle + effective_from already exists)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/costs/{name}",
  operationId: "deleteCost",
  summary: "Delete all entries for a cost unit",
  security: [{ ApiKeyAuth: [] }],
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "Number of deleted entries",
      content: { "application/json": { schema: DeleteCostResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Cost unit not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// --- Platform plans ---

registry.registerPath({
  method: "get",
  path: "/v1/platform-plans",
  operationId: "listPlatformPlans",
  summary: "List current platform plan per provider",
  responses: {
    200: {
      description: "Current platform plan for each provider",
      content: { "application/json": { schema: z.array(PlatformPlanSchema) } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/platform-plans/{provider}",
  operationId: "getPlatformPlan",
  summary: "Get current platform plan for a provider",
  request: { params: z.object({ provider: ProviderParam }) },
  responses: {
    200: {
      description: "Current platform plan",
      content: { "application/json": { schema: PlatformPlanSchema } },
    },
    404: {
      description: "No platform plan configured for this provider",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/platform-plans/{provider}/history",
  operationId: "getPlatformPlanHistory",
  summary: "Get platform plan change history for a provider",
  request: { params: z.object({ provider: ProviderParam }) },
  responses: {
    200: {
      description: "Plan change history",
      content: { "application/json": { schema: z.array(PlatformPlanSchema) } },
    },
    404: {
      description: "No platform plan configured for this provider",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/platform-plans/{provider}",
  operationId: "putPlatformPlan",
  summary: "Set or update the platform plan for a provider",
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({ provider: ProviderParam }),
    body: {
      required: true,
      content: { "application/json": { schema: PutPlatformPlanBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Inserted platform plan",
      content: { "application/json": { schema: PlatformPlanSchema } },
    },
    400: {
      description: "Invalid request body",
      content: { "application/json": { schema: ValidationErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Duplicate platform plan (provider + effective_from already exists)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerComponent("securitySchemes", "ApiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
});
