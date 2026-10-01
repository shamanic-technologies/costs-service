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
      .enum(["no-billable-price", "no-vendor-rate-on-record", "ambiguous-vendor-rate", "not-yet-stated"])
      .nullable(),
    markupMultiplier: z.string().nullable().openapi({
      description: "billed / vendor for this version (4 decimals), e.g. '6.0000' in the 6x era, '1.0000' for pass-through. Null when unknown, or when the vendor cost is 0.",
      example: "5.0000",
    }),
    vendorCostDerivation: z.enum(["pass-through", "seed-vendor-rate", "seed-vendor-rate-pre-vat", "unknown"]).openapi({
      description:
        "How the vendor cost was stated. 'seed-vendor-rate' / '-pre-vat': a vendor rate the seed carried (today or in its history) reproduces the billed price under the markup in force when the version was written. 'pass-through': billed = vendor.",
    }),
    vendorCostNote: z.string().nullable().openapi({
      description: "Why a reconstructed version exists, in words. Null on a catalogue version.",
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

// --- Paid from: which of OUR accounts pays each provider, read from the bank ledger (STAFF-ONLY, service api key) ---

export const PaidFromAccountSchema = z
  .object({
    accountId: z.string().openapi({ description: "The ledger's account id." }),
    label: z.string().openapi({ example: "Revolut Business" }),
    institutionDomain: z.string().nullable().openapi({ description: "Bank domain for a logo (logo.dev). Null when the ledger does not know the bank.", example: "revolut.com" }),
    scope: z.enum(["personal", "business"]),
    lastPaidOn: z.string().openapi({ description: "Date (YYYY-MM-DD) this account last paid this provider.", example: "2026-09-28" }),
  })
  .openapi("PaidFromAccount");

export const ProviderPaymentSourcesSchema = z
  .object({
    provider: z.string().openapi({ description: "Catalogue provider key (providers_costs.provider).", example: "openai" }),
    providerDomain: z.string().nullable().openapi({ example: "openai.com" }),
    match: z.enum(["matched", "unmatched"]).openapi({
      description: "'unmatched' = no vendor in the bank ledger could be tied to this provider (we cannot say who pays it), distinct from a matched provider.",
    }),
    ledgerVendors: z
      .array(z.object({ key: z.string(), name: z.string() }))
      .openapi({ description: "The ledger vendors joined to this provider (a vendor key starting with the provider's name or domain, longest name wins)." }),
    lastPaidOn: z.string().nullable().openapi({ description: "Latest payment across every account (YYYY-MM-DD). Null when unmatched." }),
    paidFrom: z.array(PaidFromAccountSchema).openapi({ description: "Accounts that paid this provider, most recent first. Empty when unmatched." }),
  })
  .openapi("ProviderPaymentSources");

export const ProviderPaymentSourcesListSchema = z
  .object({
    ledgerGeneratedAt: z.string().openapi({ description: "When the bank ledger produced the answer (read live, never cached)." }),
    providers: z.array(ProviderPaymentSourcesSchema),
  })
  .openapi("ProviderPaymentSourcesList");

registry.registerPath({
  method: "get",
  path: "/internal/provider-payment-sources",
  operationId: "listProviderPaymentSources",
  summary: "Every catalogue provider with the accounts that pay it, read live from the bank ledger (service api key only)",
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: {
      description: "One entry per provider in the catalogue, sorted by provider",
      content: { "application/json": { schema: ProviderPaymentSourcesListSchema } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Internal server error", content: { "application/json": { schema: ErrorResponseSchema } } },
    502: {
      description: "The bank ledger is not configured, unreachable, refused the key, or answered in an unknown shape (the error names which)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// --- Price of one cold email sent to a lead (staff-only, displayed, never billed) ---

const RefreshAttemptSchema = z
  .object({
    status: z.enum(["running", "succeeded", "failed"]),
    asOf: z.string().describe("UTC day the attempt computed for, YYYY-MM-DD"),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    error: z.string().nullable().describe("Why the attempt failed (upstream named), null otherwise"),
  })
  .openapi("EmailSendPriceRefreshAttempt");

const EmailSendPriceDaySchema = z
  .object({
    day: z.string().describe("YYYY-MM-DD; dense, one point per calendar day from the first payment or send"),
    spendUsd: z.number().describe("Net email-infrastructure spend booked that day (paid minus refunded), USD; negative on a refund-only day"),
    emailsToLeads: z.number().int().describe("Emails sent to leads that UTC day"),
    cumulativeSpendUsd: z.number(),
    cumulativeEmailsToLeads: z.number().int(),
    priceUsdCents: z.number().nullable().describe("cumulativeSpendUsd*100 / cumulativeEmailsToLeads (net); null before the first send"),
    cumulativePaidUsd: z.number().describe("Gross: every payment since inception, refunds ignored"),
    grossPriceUsdCents: z.number().nullable().describe("cumulativePaidUsd*100 / cumulativeEmailsToLeads"),
    monthToDateSpendUsd: z.number(),
    monthToDateEmailsToLeads: z.number().int(),
    monthPriceUsdCents: z.number().nullable().describe("This calendar month alone (net), through this day; null when the month sent nothing yet or its net spend is negative"),
  })
  .openapi("EmailSendPriceDay");

export const EmailSendPriceResponseSchema = z
  .object({
    formula: z.string(),
    asOf: z.string().describe("Day of the latest point = the day `currentPriceUsdCents` is for"),
    refreshedAt: z.string().describe("When the served series was computed"),
    stale: z.boolean().describe("True when the served series was not computed today (UTC): the last refresh failed or has not run yet"),
    lastRefresh: RefreshAttemptSchema.nullable().describe("The most recent attempt, failed ones included"),
    currentPriceUsdCents: z.number().nullable().describe("US cents per email sent to a lead, since inception, on NET spend (paid minus refunded)"),
    currentGrossPriceUsdCents: z.number().nullable().describe("Same on GROSS paid (refunds ignored), shown beside"),
    currentMonthPriceUsdCents: z.number().nullable(),
    totals: z.object({
      spendUsd: z.number().describe("Net consumed since inception = paidUsd - refundedUsd: the numerator of the price"),
      paidUsd: z.number().describe("Gross: every payment since inception"),
      refundedUsd: z.number().describe("Money the vendors gave back since inception"),
      emailsToLeads: z.number().int(),
    }),
    firstPaymentOn: z.string().nullable(),
    firstSendOn: z.string().nullable(),
    vendors: z.array(
      z.object({
        key: z.string().describe("Bank-ledger vendor key"),
        label: z.string(),
        what: z.string(),
        firstPaidOn: z.string().nullable(),
        lastPaidOn: z.string().nullable(),
        payments: z.number().int(),
        refunds: z.number().int(),
        paidUsd: z.number(),
        refundedUsd: z.number(),
        netUsd: z.number(),
      }),
    ).describe("The vendors counted as email infrastructure, declared in costs-service"),
    excludedVendors: z.array(z.object({ key: z.string(), reason: z.string() })),
    monthly: z.array(
      z.object({
        month: z.string().describe("YYYY-MM"),
        spendUsd: z.number().describe("Net that month"),
        spendByVendorUsd: z.record(z.string(), z.number()).describe("Net per vendor key that month"),
        paidUsd: z.number(),
        refundedUsd: z.number(),
        emailsToLeads: z.number().int(),
        monthPriceUsdCents: z.number().nullable(),
        cumulativeSpendUsd: z.number().describe("At the month's last point (month end, or today)"),
        cumulativeEmailsToLeads: z.number().int(),
        priceUsdCents: z.number().nullable(),
        cumulativePaidUsd: z.number(),
        grossPriceUsdCents: z.number().nullable(),
      }),
    ),
    daily: z.array(EmailSendPriceDaySchema).describe("Oldest first, last point = asOf"),
  })
  .openapi("EmailSendPriceResponse");

registry.registerPath({
  method: "get",
  path: "/internal/email-send-price",
  operationId: "getEmailSendPrice",
  summary: "Price of one cold email sent to a lead: infra spend since inception / emails to leads since inception, daily series (service api key only)",
  description:
    "Displayed figure only, no billed price reads it. Served from the last SUCCEEDED daily refresh; when a refresh fails the previous series stays served (`stale: true`, `lastRefresh.error` says why).",
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: { description: "The stored series", content: { "application/json": { schema: EmailSendPriceResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    503: {
      description: "Never computed yet",
      content: { "application/json": { schema: z.object({ error: z.string(), lastRefresh: RefreshAttemptSchema.nullable() }) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/email-send-price/refresh",
  operationId: "refreshEmailSendPrice",
  summary: "Recompute the email send price now from the bank ledger and instantly-service (idempotent per day)",
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: {
      description: "Refreshed",
      content: { "application/json": { schema: z.object({ refreshId: z.string(), asOf: z.string(), days: z.number().int() }) } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "A refresh is already running", content: { "application/json": { schema: ErrorResponseSchema } } },
    502: { description: "The bank ledger or instantly-service could not answer (named); nothing was written", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// --- Real cost per credit of each vendor subscription (staff-only, displayed, never billed) ---

const SubscriptionCostDaySchema = z
  .object({
    day: z.string().describe("YYYY-MM-DD; dense, one point per calendar day from 2026-01-01"),
    paidUsd: z.number().nullable().describe("Paid to the ledger vendor(s) that day, USD; null when the subscription has no ledger line"),
    netUsd: z.number().nullable().describe("Paid minus refunded that day"),
    credits: z.number().describe("Credits consumed through our account that UTC day"),
    cumulativePaidUsd: z.number().nullable(),
    cumulativeNetUsd: z.number().nullable(),
    cumulativeCredits: z.number(),
    costPerCreditUsdCents: z.number().nullable().describe("cumulativeNetUsd*100 / cumulativeCredits; null over zero credits, a negative net, or no ledger line"),
    grossCostPerCreditUsdCents: z.number().nullable().describe("cumulativePaidUsd*100 / cumulativeCredits (refunds ignored)"),
  })
  .openapi("SubscriptionCostDay");

const SubscriptionCostSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    provider: z.string().describe("Catalogue provider"),
    ledgerMatched: z.boolean().describe("False = no bank-ledger line declared: money fields are null (unknown), never 0"),
    ledgerNote: z.string().nullable(),
    ledgerVendors: z.array(
      z.object({
        key: z.string().describe("Bank-ledger vendor key"),
        firstPaidOn: z.string().nullable(),
        lastPaidOn: z.string().nullable(),
        payments: z.number().int(),
        refunds: z.number().int(),
        paidUsd: z.number(),
        refundedUsd: z.number(),
        netUsd: z.number(),
      }),
    ),
    firstPaymentOn: z.string().nullable(),
    lastPaymentOn: z.string().nullable(),
    paidUsd: z.number().nullable().describe("Since 2026-01-01"),
    refundedUsd: z.number().nullable(),
    netUsd: z.number().nullable().describe("paidUsd - refundedUsd: the numerator"),
    creditDefinition: z.string(),
    orgKeyUnitsCounted: z.boolean().describe("Whether units runs-service tags 'org' (customer key) are counted as our credits"),
    orgKeyUnitsNote: z.string().describe("Why (evidence when counted)"),
    credits: z.number().describe("Credits consumed through our account since 2026-01-01: the denominator"),
    costPerCreditUsdCents: z.number().nullable().describe("Real cost of one credit, US cents, on NET paid"),
    grossCostPerCreditUsdCents: z.number().nullable(),
    costPerCreditNullReason: z.enum(["no-ledger-line", "no-credit-consumed", "negative-net-paid"]).nullable(),
    costItems: z.array(
      z.object({
        costName: z.string(),
        isCredit: z.boolean(),
        excludedReason: z.string().nullable(),
        quantityPlatformKey: z.number().describe("Units since 2026-01-01 through our platform key"),
        quantityOrgKey: z.number().describe("Units since 2026-01-01 runs-service tags as a customer's own key"),
        creditsCounted: z.number(),
        unit: z.string().nullable(),
        billedPricePerUnitInUsdCents: z.number().nullable().describe("Catalogue price in force now"),
        vendorCostPerUnitInUsdCents: z.number().nullable().describe("Catalogue vendor cost of that version"),
        catalogueNote: z.string().nullable().describe("Why the catalogue fields are null"),
      }),
    ),
    monthly: z.array(
      z.object({
        month: z.string().describe("YYYY-MM"),
        paidUsd: z.number().nullable(),
        refundedUsd: z.number().nullable(),
        netUsd: z.number().nullable(),
        credits: z.number(),
        monthCostPerCreditUsdCents: z.number().nullable().describe("This month alone"),
        cumulativeNetUsd: z.number().nullable(),
        cumulativeCredits: z.number(),
        costPerCreditUsdCents: z.number().nullable().describe("Running since 2026-01-01 at the month's last point"),
        grossCostPerCreditUsdCents: z.number().nullable(),
      }),
    ),
    daily: z.array(SubscriptionCostDaySchema).describe("Oldest first, last point = asOf"),
  })
  .openapi("SubscriptionCost");

export const SubscriptionCostsResponseSchema = z
  .object({
    formula: z.string(),
    since: z.string().describe("2026-01-01: owner start date"),
    asOf: z.string(),
    refreshedAt: z.string(),
    stale: z.boolean().describe("True when the served series was not computed today (UTC)"),
    lastRefresh: RefreshAttemptSchema.nullable(),
    subscriptions: z.array(SubscriptionCostSchema).describe("Declared in costs-service src/lib/subscriptions.ts"),
  })
  .openapi("SubscriptionCostsResponse");

registry.registerPath({
  method: "get",
  path: "/internal/subscription-costs",
  operationId: "getSubscriptionCosts",
  summary: "Real cost per credit of each vendor subscription: net paid since 2026-01-01 / credits consumed since 2026-01-01, daily series (service api key only)",
  description:
    "Displayed figure only, no billed price reads it. Served from the last SUCCEEDED daily refresh; when a refresh fails the previous series stays served (`stale: true`, `lastRefresh.error` says why).",
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: { description: "The stored series", content: { "application/json": { schema: SubscriptionCostsResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    503: {
      description: "Never computed yet",
      content: { "application/json": { schema: z.object({ error: z.string(), lastRefresh: RefreshAttemptSchema.nullable() }) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/subscription-costs/refresh",
  operationId: "refreshSubscriptionCosts",
  summary: "Recompute the subscription costs now from the bank ledger and runs-service (idempotent per day)",
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: {
      description: "Refreshed",
      content: {
        "application/json": {
          schema: z.object({ refreshId: z.string(), asOf: z.string(), days: z.number().int(), subscriptions: z.number().int() }),
        },
      },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "A refresh is already running", content: { "application/json": { schema: ErrorResponseSchema } } },
    502: { description: "The bank ledger or runs-service could not answer (named); nothing was written", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// --- Real cost per unit, proposed price list, price list at a date, comparison (staff-only, displayed, never billed) ---

const RealCostItemSchema = z
  .object({
    costName: z.string(),
    provider: z.string().nullable(),
    method: z.enum(["email-send-price", "pass-through", "subscription", "pay-as-you-go-ratio", "catalogue-vendor-cost", "included-at-vendor"]),
    flag: z
      .enum(["no-email-sent-yet", "not-a-subscription-credit", "no-real-cost-per-credit", "no-payment-yet", "no-metered-spend-yet", "no-recorded-usage-yet", "no-ledger-line", "declared-catalogue-vendor-cost", "no-vendor-cost", "included-in-another-cost", "legacy-name-priced-as-successor"])
      .nullable()
      .describe("Why the item fell back to its catalogue vendor cost (or kept its price); null = its specific real cost applies"),
    realCostPerUnitUsdCents: z.number().nullable(),
    ratio: z.number().nullable().describe("Pay-as-you-go: net paid / vendor cost recorded, through the day"),
    catalogueVendorCostPerUnitUsdCents: z.number().nullable(),
    cataloguePricePerUnitUsdCents: z.number().nullable(),
    catalogueMarkupOnRealCost: z.number().nullable().describe("catalogue price / real cost"),
    multiplier: z.number().describe("2 for production tools, 1 for pass-through (Stripe, media)"),
    proposedPricePerUnitUsdCents: z.number().nullable(),
    proposedBasis: z.enum(["real-cost-x2", "real-cost-x1", "current-price-kept", "no-price"]),
    proposedVsCataloguePct: z.number().nullable(),
  })
  .openapi("RealCostItem");

registry.registerPath({
  method: "get",
  path: "/internal/real-costs",
  operationId: "getRealCosts",
  summary: "Real cost per unit and proposed price of every cost item on a day (default latest), service api key only",
  description: "Display only. Query `day=YYYY-MM-DD` (2026-01-01 through asOf). 503 before the first refresh.",
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: {
      description: "Every item",
      content: {
        "application/json": {
          schema: z.object({
            formula: z.string(),
            rules: z.record(z.string(), z.unknown()).describe("Every owner-reviewable declaration (multipliers, x1 rule, vendors)"),
            day: z.string(),
            asOf: z.string(),
            refreshedAt: z.string(),
            stale: z.boolean(),
            lastRefresh: RefreshAttemptSchema.nullable(),
            payAsYouGo: z.array(
              z.object({
                provider: z.string(),
                ledgerVendors: z.array(z.string()),
                paidUsdCents: z.number(),
                refundedUsdCents: z.number(),
                netPaidUsdCents: z.number(),
                numeratorBasis: z.string().describe("What the ratio's numerator counts: `ledger-net-paid`, or the vendor's own split (`twilio-usage-metered`)"),
                meteredUsdCents: z.number().describe("The ratio's numerator: metered spend through the day"),
                vendorCostRecordedUsdCents: z.number(),
                ratio: z.number().nullable().describe("meteredUsdCents / vendorCostRecordedUsdCents"),
                split: z
                  .object({
                    parts: z.array(
                      z.object({
                        part: z.string().describe("metered | rental | other | unconsumed-balance"),
                        usdCents: z.number().nullable(),
                        basis: z.string().nullable(),
                        loadedOnUnits: z.boolean().describe("Only the metered part is loaded on units"),
                        flag: z.string().nullable(),
                      }),
                    ),
                    unexplained: z.object({
                      usdCents: z.number().nullable().describe("Bank net paid - consumed per the vendor - balance left (refresh day only)"),
                      basis: z.string(),
                      loadedOnUnits: z.literal(false),
                      flag: z.string(),
                    }),
                  })
                  .nullable()
                  .describe("Where the bank money went, for a vendor whose money is split; null when the numerator is the ledger net paid"),
              }),
            ),
            items: z.array(RealCostItemSchema),
          }),
        },
      },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Day outside the series", content: { "application/json": { schema: ErrorResponseSchema } } },
    503: { description: "Never computed yet", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/real-costs/{costName}",
  operationId: "getRealCostSeries",
  summary: "One cost item's real cost and proposed price per day since 2026-01-01",
  security: [{ ApiKeyAuth: [] }],
  request: { params: z.object({ costName: z.string() }) },
  responses: {
    200: {
      description: "Daily series",
      content: { "application/json": { schema: z.object({ costName: z.string(), daily: z.array(RealCostItemSchema.extend({ day: z.string() })) }) } },
    },
    404: { description: "No series for that name", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/price-lists",
  operationId: "getPriceList",
  summary: "A price list at a date: catalogue (version in force at the day's end) or proposed (that day's computed list)",
  security: [{ ApiKeyAuth: [] }],
  request: { query: z.object({ source: z.enum(["catalogue", "proposed"]), date: z.string().describe("YYYY-MM-DD") }) },
  responses: {
    200: {
      description: "Price per cost item",
      content: {
        "application/json": {
          schema: z.object({
            source: z.enum(["catalogue", "proposed"]),
            date: z.string(),
            items: z.array(z.object({ costName: z.string(), provider: z.string().nullable(), pricePerUnitUsdCents: z.number().nullable() }).passthrough()),
          }),
        },
      },
    },
    400: { description: "Bad source or date", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Proposed list not computed for that date", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

const ComparisonFiguresSchema = z.object({
  amount1UsdCents: z.number(),
  amount2UsdCents: z.number(),
  differenceUsdCents: z.number().describe("amount2 - amount1"),
  differencePct: z.number().nullable().describe("vs amount1"),
  realCostUsdCents: z.number(),
  margin1UsdCents: z.number(),
  margin1Pct: z.number().nullable(),
  margin2UsdCents: z.number(),
  margin2Pct: z.number().nullable(),
  billedUsdCents: z.number().describe("Actually billed, gross"),
  netBilledUsdCents: z.number().describe("Actually billed, net of the per-org discount"),
  billedPlatformKeyUsdCents: z.number().describe("Platform-key part of billed = runs-service margin read's billed"),
  netBilledPlatformKeyUsdCents: z.number(),
});

registry.registerPath({
  method: "get",
  path: "/internal/price-comparison",
  operationId: "comparePriceLists",
  summary: "Replay a perimeter's consumption since inception under two price lists, with real cost, margins and actually billed",
  security: [{ ApiKeyAuth: [] }],
  request: {
    query: z.object({
      list1: z.string().describe("<catalogue|proposed>:<YYYY-MM-DD>"),
      list2: z.string().describe("<catalogue|proposed>:<YYYY-MM-DD>"),
      orgId: z.string().optional().describe("Org perimeter (internal org UUID)"),
      brandId: z.string().optional().describe("With orgId: org x brand perimeter"),
      interval: z.enum(["day", "week", "month"]).optional().describe("Bucket size, default month; weeks start Monday"),
    }),
  },
  responses: {
    200: {
      description: "Totals, buckets with cumulative, per cost item; at fleet grain per org and per brand ranked by difference",
      content: {
        "application/json": {
          schema: z.object({
            perimeter: z.object({ grain: z.enum(["fleet", "org", "org-brand"]), orgId: z.string().optional(), brandId: z.string().optional() }),
            list1: z.object({ source: z.string(), date: z.string() }),
            list2: z.object({ source: z.string(), date: z.string() }),
            interval: z.string(),
            consumptionAsOf: z.string(),
            stale: z.boolean(),
            notes: z.array(z.string()),
            totals: ComparisonFiguresSchema,
            unpricedCostNames1: z.array(z.string()),
            unpricedCostNames2: z.array(z.string()),
            realCostUnknownCostNames: z.array(z.string()),
            buckets: z.array(ComparisonFiguresSchema.extend({ period: z.string(), cumulative: ComparisonFiguresSchema })),
            costItems: z.array(
              ComparisonFiguresSchema.extend({
                costName: z.string(),
                quantity: z.number(),
                quantityPlatformKey: z.number(),
                price1PerUnitUsdCents: z.number().nullable(),
                price2PerUnitUsdCents: z.number().nullable(),
                unpricedQuantity1: z.number(),
                unpricedQuantity2: z.number(),
                realCostUnknownQuantity: z.number(),
              }),
            ),
            byOrg: z.array(ComparisonFiguresSchema.extend({ orgId: z.string().nullable() })).nullable(),
            byBrand: z.array(ComparisonFiguresSchema.extend({ orgId: z.string().nullable(), brandId: z.string().nullable() })).nullable(),
          }),
        },
      },
    },
    400: { description: "Bad list, perimeter or interval", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Proposed list not computed for that date", content: { "application/json": { schema: ErrorResponseSchema } } },
    503: { description: "Real costs never computed yet", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/real-costs/refresh",
  operationId: "refreshRealCosts",
  summary: "Recompute the real costs and proposed list now (idempotent per day)",
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: {
      description: "Refreshed",
      content: { "application/json": { schema: z.object({ refreshId: z.string(), asOf: z.string(), days: z.number().int(), costItems: z.number().int() }) } },
    },
    409: { description: "A refresh is already running", content: { "application/json": { schema: ErrorResponseSchema } } },
    502: { description: "Bank ledger or runs-service could not answer (named); nothing written", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerComponent("securitySchemes", "ApiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
});
