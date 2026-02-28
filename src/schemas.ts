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

export const ProviderCostSchema = z
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
  .openapi("ProviderCost");

export const PriceSchema = z
  .object({
    name: z.string(),
    pricePerUnitInUsdCents: z.string(),
    provider: z.string(),
    effectiveFrom: z.string().datetime(),
  })
  .openapi("Price");

export const PlatformCostSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.string(),
    planTier: z.string(),
    billingCycle: z.string(),
    effectiveFrom: z.string().datetime(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("PlatformCost");

// --- PUT /v1/providers-costs/:name ---

export const PutProviderCostBodySchema = z
  .object({
    costPerUnitInUsdCents: z.union([z.string(), z.number()]),
    provider: z.string(),
    planTier: z.string(),
    billingCycle: z.string(),
    effectiveFrom: z.string().datetime().optional(),
  })
  .openapi("PutProviderCostBody");

// --- PUT /v1/platform-costs/:provider ---

export const PutPlatformCostBodySchema = z
  .object({
    planTier: z.string(),
    billingCycle: z.string(),
    effectiveFrom: z.string().datetime().optional(),
  })
  .openapi("PutPlatformCostBody");

// --- DELETE /v1/providers-costs/:name ---

export const DeleteProviderCostResponseSchema = z
  .object({
    deleted: z.number(),
  })
  .openapi("DeleteProviderCostResponse");

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
    description: "Provider cost identifier ({provider}-{service-or-model}-{unit-type})",
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

// --- Providers costs (catalog) ---

registry.registerPath({
  method: "get",
  path: "/v1/providers-costs",
  operationId: "listProvidersCosts",
  summary: "List all provider costs (resolved via platform plan per provider)",
  responses: {
    200: {
      description: "List of current provider costs",
      content: { "application/json": { schema: z.array(ProviderCostSchema) } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/providers-costs/{name}",
  operationId: "getProviderCost",
  summary: "Get current provider cost (resolved via platform plan)",
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "Current provider cost",
      content: { "application/json": { schema: ProviderCostSchema } },
    },
    404: {
      description: "Provider cost not found",
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
  path: "/v1/providers-costs/{name}/history",
  operationId: "getProviderCostHistory",
  summary: "Get all price points for a provider cost",
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "Price history",
      content: { "application/json": { schema: z.array(ProviderCostSchema) } },
    },
    404: {
      description: "Provider cost not found",
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
  path: "/v1/providers-costs/{name}/plans",
  operationId: "getProviderCostPlans",
  summary: "List all known plan options for a provider cost",
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "All plan/billing cycle combinations for this cost",
      content: { "application/json": { schema: z.array(ProviderCostSchema) } },
    },
    404: {
      description: "Provider cost not found",
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
  path: "/v1/providers-costs/{name}",
  operationId: "putProviderCost",
  summary: "Insert a new price point for a provider cost",
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({ name: CostNameParam }),
    body: {
      required: true,
      content: { "application/json": { schema: PutProviderCostBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Inserted provider cost",
      content: { "application/json": { schema: ProviderCostSchema } },
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
      description: "Duplicate provider cost (name + plan_tier + billing_cycle + effective_from already exists)",
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
  path: "/v1/providers-costs/{name}",
  operationId: "deleteProviderCost",
  summary: "Delete all entries for a provider cost",
  security: [{ ApiKeyAuth: [] }],
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "Number of deleted entries",
      content: { "application/json": { schema: DeleteProviderCostResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Provider cost not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// --- Platform prices (consumer-facing, resolved via platform cost config) ---

registry.registerPath({
  method: "get",
  path: "/v1/platform-prices",
  operationId: "listPlatformPrices",
  summary: "List current platform prices for all cost names",
  responses: {
    200: {
      description: "Current prices resolved via platform plan",
      content: { "application/json": { schema: z.array(PriceSchema) } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/platform-prices/{name}",
  operationId: "getPlatformPrice",
  summary: "Get current platform price for a cost name",
  request: { params: z.object({ name: CostNameParam }) },
  responses: {
    200: {
      description: "Current price",
      content: { "application/json": { schema: PriceSchema } },
    },
    404: {
      description: "Price not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description: "Internal server error (e.g. no platform plan configured)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// --- Platform costs ---

registry.registerPath({
  method: "get",
  path: "/v1/platform-costs",
  operationId: "listPlatformCosts",
  summary: "List current platform cost config per provider",
  responses: {
    200: {
      description: "Current platform cost config for each provider",
      content: { "application/json": { schema: z.array(PlatformCostSchema) } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/platform-costs/{provider}",
  operationId: "getPlatformCost",
  summary: "Get current platform cost config for a provider",
  request: { params: z.object({ provider: ProviderParam }) },
  responses: {
    200: {
      description: "Current platform cost config",
      content: { "application/json": { schema: PlatformCostSchema } },
    },
    404: {
      description: "No platform cost configured for this provider",
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
  path: "/v1/platform-costs/{provider}/history",
  operationId: "getPlatformCostHistory",
  summary: "Get platform cost change history for a provider",
  request: { params: z.object({ provider: ProviderParam }) },
  responses: {
    200: {
      description: "Cost config change history",
      content: { "application/json": { schema: z.array(PlatformCostSchema) } },
    },
    404: {
      description: "No platform cost configured for this provider",
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
  path: "/v1/platform-costs/{provider}",
  operationId: "putPlatformCost",
  summary: "Set or update the platform cost config for a provider",
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({ provider: ProviderParam }),
    body: {
      required: true,
      content: { "application/json": { schema: PutPlatformCostBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Inserted platform cost config",
      content: { "application/json": { schema: PlatformCostSchema } },
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
      description: "Duplicate platform cost (provider + effective_from already exists)",
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
