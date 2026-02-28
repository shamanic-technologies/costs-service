# costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning and multi-plan support.

**Stack:** Express + Drizzle ORM + PostgreSQL

## Unit costs catalog

| Name | Cost (USD cents/unit) | Unit | Provider | Plan | Billing |
|---|---|---|---|---|---|
| `apollo-search-credit` | 0.00 | 1 search credit | Apollo | basic | monthly |
| `apollo-enrichment-credit` | 2.36 | 1 enrichment credit | Apollo | basic | monthly |
| `apollo-person-match-credit` | 2.36 | 1 person match credit | Apollo | basic | monthly |
| `anthropic-opus-4.5-tokens-input` | 0.0005 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-opus-4.5-tokens-output` | 0.0025 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-sonnet-4.5-tokens-input` | 0.0003 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-sonnet-4.5-tokens-output` | 0.0015 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-sonnet-4.6-tokens-input` | 0.0003 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-sonnet-4.6-tokens-output` | 0.0015 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-opus-4-6-input-token` | 0.0005 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-opus-4-6-output-token` | 0.0025 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-haiku-4.5-tokens-input` | 0.0001 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-haiku-4.5-tokens-output` | 0.0005 | 1 token | Anthropic | pay-as-you-go | monthly |
| `postmark-email-send` | 0.18 | 1 email | Postmark | basic | monthly |
| `firecrawl-scrape-credit` | 0.6333333333 | 1 scrape credit | Firecrawl | hobby | monthly |
| `firecrawl-map-credit` | 0.6333333333 | 1 map credit | Firecrawl | hobby | monthly |
| `gemini-3-flash-tokens-input` | 0.00005 | 1 token | Google | pay-as-you-go | monthly |
| `gemini-3-flash-tokens-output` | 0.0003 | 1 token | Google | pay-as-you-go | monthly |
| `instantly-email-send` | 0.94 | 1 email | Instantly | growth | monthly |
| `twilio-sms-segment` | 1.33 | 1 SMS segment | Twilio | pay-as-you-go | monthly |

### Naming convention

```
{provider}-{service-or-model}-{unit-type}
```

Examples: `apollo-enrichment-credit`, `anthropic-opus-4.5-tokens-input`, `postmark-email-send`

## Platform plans

Each provider has an active platform plan that determines which cost tier is used for billing. The `GET /v1/costs/:name` endpoint resolves costs via the active platform plan — no fallbacks.

| Provider | Current Plan | Billing |
|---|---|---|
| apollo | basic | monthly |
| anthropic | pay-as-you-go | monthly |
| firecrawl | hobby | monthly |
| gemini | pay-as-you-go | monthly |
| instantly | growth | monthly |
| postmark | basic | monthly |
| twilio | pay-as-you-go | monthly |

## API

### Costs

All endpoints are prefixed with `/v1/costs`. Write endpoints require `x-api-key` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/costs` | No | List current price for every cost name (resolved via platform plan) |
| GET | `/v1/costs/:name` | No | Get current price for one cost name (resolved via platform plan) |
| GET | `/v1/costs/:name/history` | No | Get all historical prices for a cost name |
| GET | `/v1/costs/:name/plans` | No | List all known plan options for a cost name |
| PUT | `/v1/costs/:name` | Yes | Insert a new price point |
| DELETE | `/v1/costs/:name` | Yes | Delete all entries for a cost name |

#### PUT /v1/costs/:name body

```json
{
  "costPerUnitInUsdCents": 0.0005,
  "provider": "anthropic",
  "planTier": "pay-as-you-go",
  "billingCycle": "monthly",
  "effectiveFrom": "2025-06-01T00:00:00Z"
}
```

`effectiveFrom` defaults to now if omitted. All other fields are required.

### Platform plans

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/platform-plans` | No | List current plan per provider |
| GET | `/v1/platform-plans/:provider` | No | Get current plan for a provider |
| GET | `/v1/platform-plans/:provider/history` | No | Plan change history for a provider |
| PUT | `/v1/platform-plans/:provider` | Yes | Set/update plan for a provider |

#### PUT /v1/platform-plans/:provider body

```json
{
  "planTier": "business",
  "billingCycle": "annual",
  "effectiveFrom": "2026-02-28T00:00:00Z"
}
```

`effectiveFrom` defaults to now if omitted.

### Other endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Health check |
| GET | `/openapi.json` | No | OpenAPI 3.0 spec |

## Setup

```bash
cp .env.example .env   # set COSTS_SERVICE_DATABASE_URL and COSTS_SERVICE_API_KEY
npm install
npm run db:migrate
npm run dev            # localhost:3011
```

## Tests

```bash
npm test               # all tests
npm run test:unit
npm run test:integration
```
