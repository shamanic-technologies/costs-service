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
    providerDomain: z.string().nullable(),
    type: z.string(),
    unit: z.string(),
    planTier: z.string(),
    billingCycle: z.string(),
    costPerUnitInUsdCents: z.string().nullable().openapi({
      description:
        "The price we charge per unit, or null when this line carries NO billable price any more (a cost we still incur but stopped rebilling — the cold-email infrastructure lines). Null is not zero: zero would assert the line is free, which is false. A null-priced newest version delists the name from the current catalog listing while every by-name read keeps resolving it, so spend already declared against the name stays readable.",
      example: "0.0005000000",
    }),
    pricingBasis: z.enum(["marked-up", "pass-through"]).openapi({
      description:
        "Whether this line carries a markup. 'pass-through' means the price IS the vendor's — money we merely route (advertising-platform spend, payment-processing fees) reaches the customer at cost, with no markup. 'marked-up' means work we perform (LLM tokens, embeddings, enrichment, search, creative generation), priced at the vendor rate times the store multiplier. Always present: a line's class is never inferred by the caller.",
      example: "pass-through",
    }),
    pricingRegime: z.string().nullable().openapi({
      description:
        "Time-of-day pricing regime this price belongs to ('peak' or 'off-peak'), or null when the provider charges one rate at every hour. The cost name carries the same segment.",
      example: "peak",
    }),
    regimeHoursUtc: z.string().nullable().openapi({
      description:
        "UTC windows during which this regime is in force, as comma-separated half-open HH:MM-HH:MM ranges. Null when pricingRegime is null. A provider's regimes partition the day, so exactly one cost name matches any instant.",
      example: "01:00-04:00,06:00-10:00",
    }),
    effectiveFrom: z.string().datetime(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("ProviderCost");

export const PriceSchema = z
  .object({
    name: z.string(),
    pricePerUnitInUsdCents: z.string().nullable().openapi({
      description:
        "Current price per unit, or null when the line has no billable price any more. Never zero for a delisted line: absence of a price is the honest representation of 'we still pay for this, we just stopped charging for it'.",
      example: "0.0005000000",
    }),
    billable: z.boolean().openapi({
      description:
        "Whether this line is something we currently charge for. False only on a delisted line, which is served by name for historical reads but never appears in GET /v1/platform-prices.",
      example: true,
    }),
    provider: z.string(),
    providerDomain: z.string().nullable(),
    type: z.string(),
    unit: z.string(),
    pricingBasis: z.enum(["marked-up", "pass-through"]).openapi({
      description:
        "Whether this line carries a markup. 'pass-through' means the price IS the vendor's — money we merely route (advertising-platform spend, payment-processing fees) reaches the customer at cost, with no markup. 'marked-up' means work we perform (LLM tokens, embeddings, enrichment, search, creative generation), priced at the vendor rate times the store multiplier. Always present: a line's class is never inferred by the caller.",
      example: "pass-through",
    }),
    pricingRegime: z.string().nullable().openapi({
      description:
        "Time-of-day pricing regime this price belongs to ('peak' or 'off-peak'), or null when the provider charges one rate at every hour. The cost name carries the same segment, so a consumer picks the name for a moment rather than computing a rate.",
      example: "peak",
    }),
    regimeHoursUtc: z.string().nullable().openapi({
      description:
        "UTC windows during which this regime is in force, as comma-separated half-open HH:MM-HH:MM ranges (a window may wrap past 24:00 only as the literal end 24:00). Null when pricingRegime is null. A provider's regimes partition the day, so for a given model and token class exactly one cost name matches any instant.",
      example: "01:00-04:00,06:00-10:00",
    }),
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
    pricingBasis: z.enum(["marked-up", "pass-through"]).openapi({
      description:
        "Required. 'pass-through' for money we route at the vendor price (ad-platform spend, payment fees), 'marked-up' for work we perform. No default — a price point whose class is unstated is rejected.",
      example: "marked-up",
    }),
    provider: z.string(),
    providerDomain: z.string().nullable().optional(),
    type: z.string(),
    unit: z.string(),
    planTier: z.string(),
    billingCycle: z.string(),
    pricingRegime: z.string().nullable().optional(),
    regimeHoursUtc: z.string().nullable().optional(),
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

// --- Header parameters ---

const OrgIdHeader = registry.registerParameter(
  "OrgId",
  z.string().uuid().openapi({
    param: { name: "x-org-id", in: "header" },
    description: "Internal org UUID from client-service",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
);

const UserIdHeader = registry.registerParameter(
  "UserId",
  z.string().uuid().openapi({
    param: { name: "x-user-id", in: "header" },
    description: "Internal user UUID from client-service",
    example: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  })
);

const RunIdHeader = registry.registerParameter(
  "RunId",
  z.string().uuid().openapi({
    param: { name: "x-run-id", in: "header" },
    description: "Run UUID from runs-service identifying the current execution",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
);

// --- Optional workflow tracking headers ---

const CampaignIdHeader = registry.registerParameter(
  "CampaignId",
  z.string().optional().openapi({
    param: { name: "x-campaign-id", in: "header" },
    description: "Campaign identifier injected by workflow-service (optional)",
    example: "camp_abc123",
  })
);

const BrandIdHeader = registry.registerParameter(
  "BrandId",
  z.string().optional().openapi({
    param: { name: "x-brand-id", in: "header" },
    description: "Brand identifier(s) injected by workflow-service (optional). Supports comma-separated UUIDs for multi-brand campaigns, e.g. 'uuid1,uuid2,uuid3'.",
    example: "550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  })
);

const WorkflowSlugHeader = registry.registerParameter(
  "WorkflowSlug",
  z.string().optional().openapi({
    param: { name: "x-workflow-slug", in: "header" },
    description: "Workflow slug injected by workflow-service (optional)",
    example: "lead-enrichment-v2",
  })
);

const FeatureSlugHeader = registry.registerParameter(
  "FeatureSlug",
  z.string().optional().openapi({
    param: { name: "x-feature-slug", in: "header" },
    description: "Feature slug for tracking which feature triggered the request (optional)",
    example: "press-outreach",
  })
);

const AudienceIdHeader = registry.registerParameter(
  "AudienceId",
  z.string().optional().openapi({
    param: { name: "x-audience-id", in: "header" },
    description: "Priority audience identifier chosen by campaign-service for cost attribution, injected by workflow-service (optional)",
    example: "aud_abc123",
  })
);

const identityHeaders = z.object({
  "x-org-id": OrgIdHeader,
  "x-user-id": UserIdHeader,
  "x-run-id": RunIdHeader,
  "x-campaign-id": CampaignIdHeader,
  "x-brand-id": BrandIdHeader,
  "x-workflow-slug": WorkflowSlugHeader,
  "x-feature-slug": FeatureSlugHeader,
  "x-audience-id": AudienceIdHeader,
});

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
  request: { headers: identityHeaders },
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
  request: { params: z.object({ name: CostNameParam }), headers: identityHeaders },
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
  request: { params: z.object({ name: CostNameParam }), headers: identityHeaders },
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
  request: { params: z.object({ name: CostNameParam }), headers: identityHeaders },
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
    headers: identityHeaders,
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
    404: {
      description: "Unknown cost name — cost must already exist in the catalog",
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
  request: { params: z.object({ name: CostNameParam }), headers: identityHeaders },
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
  summary: "List current platform prices for all cost names (public, no identity headers required)",
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
  summary: "Get current platform price for a cost name (public, no identity headers required)",
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
  request: { headers: identityHeaders },
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
  request: { params: z.object({ provider: ProviderParam }), headers: identityHeaders },
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
  request: { params: z.object({ provider: ProviderParam }), headers: identityHeaders },
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
    headers: identityHeaders,
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

// --- Vendor cost per price version (STAFF-ONLY, service api key) ---
//
// The vendor cost reveals our margin. These reads require X-API-Key and nothing else; they are
// never proxied by the public gateway, and no /v1/* response carries any of these fields.

export const VendorCostVersionSchema = z
  .object({
    id: z.string().openapi({ description: "The providers_costs row (price version) id — a uuid, or a synthetic 'reconstructed:<name>:<plan>:<billed>' id on a reconstructed version." }),
    name: z.string(),
    provider: z.string(),
    planTier: z.string(),
    billingCycle: z.string(),
    unit: z.string().nullable().openapi({ description: "Null only on a reconstructed version." }),
    pricingBasis: z.enum(["marked-up", "pass-through"]),
    pricingRegime: z.string().nullable(),
    billedPricePerUnitInUsdCents: z.string().nullable().openapi({
      description:
        "The price this version charged per unit — byte-equal to what /v1/platform-prices/{name} served while it was in force. Null on a delisted version.",
      example: "0.0005000000",
    }),
    vendorCostPerUnitInUsdCents: z.string().nullable().openapi({
      description:
        "What one unit REALLY cost us from the vendor at this version, before our markup, non-recoverable VAT included (DeepSeek: list price x 1.06). Stated only when a vendor rate on record reproduces the billed price exactly under the markup in force when the version was written. Null = unknown (see vendorCostUnknownReason); never the billed price, never billed / today's multiplier.",
      example: "0.0001000000",
    }),
    vendorCostKnown: z.boolean(),
    vendorCostUnknownReason: z
      .enum(["no-billable-price", "no-vendor-rate-on-record", "ambiguous-vendor-rate", "vendor-rate-not-retained", "not-yet-stated"])
      .nullable(),
    markupMultiplier: z.string().nullable().openapi({
      description: "billed / vendor for this version (4 decimals), e.g. '6.0000' in the 6x era, '1.0000' for pass-through. Null when unknown, or when the vendor cost is 0.",
      example: "5.0000",
    }),
    vendorCostDerivation: z.enum(["pass-through", "seed-vendor-rate", "seed-vendor-rate-pre-vat", "paid-allocation", "vendor-list-price", "unknown"]).openapi({
      description:
        "How the vendor cost was stated. 'seed-vendor-rate' / '-pre-vat': a vendor rate the seed records reproduces the billed price. 'paid-allocation': what we actually paid (bank charges, prorated) divided by the units production recorded — the cold-email infrastructure and Featured lines, whose seed rate was a model. 'vendor-list-price': the vendor's list price, where the billed row itself was wrong (mis-seeded) or the unit is free. 'pass-through': billed = vendor.",
    }),
    vendorCostNote: z.string().nullable().openapi({
      description: "Where a stated (non-seed) vendor cost comes from, or why it cannot be known, in words. Null for a plain seed reproduction.",
    }),
    reconstructed: z.boolean().openapi({
      description:
        "True for a price version overwritten in place before v0.25.0 (2026-06-07) and therefore absent from the catalogue: listed so a cost row that froze its price can still be priced. Its id is synthetic, effectiveFrom = createdAt = the first day it was billed, and markupMultiplier is null (it prices old cost rows; it is not a markup in force).",
    }),
    effectiveFrom: z.string().datetime(),
    createdAt: z.string().datetime().openapi({
      description: "When this version was written. It was served from max(effectiveFrom, createdAt).",
    }),
  })
  .openapi("VendorCostVersion");

export const VendorCostVersionListSchema = z
  .object({ versions: z.array(VendorCostVersionSchema) })
  .openapi("VendorCostVersionList");

export const VendorCostAtSchema = z
  .object({ at: z.string().datetime(), version: VendorCostVersionSchema })
  .openapi("VendorCostAt");

registry.registerPath({
  method: "get",
  path: "/internal/vendor-costs",
  operationId: "listVendorCosts",
  summary: "Every price version of every cost name, with its vendor cost (service api key only)",
  description:
    "Bulk read for joins: match a recorded cost on name + billedPricePerUnitInUsdCents, using the version served at the record's time (served from max(effectiveFrom, createdAt)). No identity headers.",
  security: [{ ApiKeyAuth: [] }],
  request: {
    query: z.object({
      names: z.string().optional().openapi({ description: "Comma-separated cost names to restrict to." }),
    }),
  },
  responses: {
    200: { description: "All price versions", content: { "application/json": { schema: VendorCostVersionListSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Internal server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/vendor-costs/{name}",
  operationId: "getVendorCostAt",
  summary: "The price version of a cost name in force at an instant, with its vendor cost (service api key only)",
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({ name: CostNameParam }),
    query: z.object({
      at: z.string().datetime().optional().openapi({ description: "ISO-8601 instant; defaults to now." }),
    }),
  },
  responses: {
    200: { description: "Version in force at `at`", content: { "application/json": { schema: VendorCostAtSchema } } },
    400: { description: "Invalid `at`", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "No version in force at `at`", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Internal server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerComponent("securitySchemes", "ApiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
});
