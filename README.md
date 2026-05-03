# costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning and multi-plan support.

**Stack:** Express + Drizzle ORM + PostgreSQL

## Unit costs catalog

All provider seed costs apply `COST_RISK_MULTIPLIER = 2` to cover cost risk.

| Name | Cost (USD cents/unit) | Unit | Provider | Plan | Billing |
|---|---|---|---|---|---|
| `apollo-credit` | 4.72 | 1 Apollo credit | Apollo | basic | monthly |
| `anthropic-opus-4.5-tokens-input` | 0.001 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-opus-4.5-tokens-output` | 0.005 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-sonnet-4.5-tokens-input` | 0.0006 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-sonnet-4.5-tokens-output` | 0.003 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-sonnet-4.6-tokens-input` | 0.0006 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-sonnet-4.6-tokens-output` | 0.003 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-opus-4.6-tokens-input` | 0.001 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-opus-4.6-tokens-output` | 0.005 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-haiku-4.5-tokens-input` | 0.0002 | 1 token | Anthropic | pay-as-you-go | monthly |
| `anthropic-haiku-4.5-tokens-output` | 0.001 | 1 token | Anthropic | pay-as-you-go | monthly |
| `postmark-email-send` | 0.3 | 1 email | Postmark | basic-10k | monthly |
| `postmark-email-send` | 0.33 | 1 email | Postmark | pro-10k | monthly |
| `postmark-email-send` | 0.36 | 1 email | Postmark | platform-10k | monthly |
| `firecrawl-scrape-credit` | 1.2666666666 | 1 scrape credit | Firecrawl | hobby | monthly |
| `firecrawl-map-credit` | 1.2666666666 | 1 map credit | Firecrawl | hobby | monthly |
| `firecrawl-extract-token` | 0.0844444444 | 1 extract token | Firecrawl | hobby | monthly |
| `google-flash-3-tokens-input` | 0.0001 | 1 token | Google | pay-as-you-go | monthly |
| `google-flash-3-tokens-output` | 0.0006 | 1 token | Google | pay-as-you-go | monthly |
| `google-flash-2.5-tokens-input` | 0.00006 | 1 token | Google | pay-as-you-go | monthly |
| `google-flash-2.5-tokens-output` | 0.0005 | 1 token | Google | pay-as-you-go | monthly |
| `google-flash-lite-2.5-tokens-input` | 0.00002 | 1 token | Google | pay-as-you-go | monthly |
| `google-flash-lite-2.5-tokens-output` | 0.00008 | 1 token | Google | pay-as-you-go | monthly |
| `google-flash-lite-3.1-tokens-input` | 0.00005 | 1 token | Google | pay-as-you-go | monthly |
| `google-flash-lite-3.1-tokens-output` | 0.0003 | 1 token | Google | pay-as-you-go | monthly |
| `google-pro-2.5-tokens-input` | 0.00025 | 1 token | Google | pay-as-you-go | monthly |
| `google-pro-2.5-tokens-output` | 0.002 | 1 token | Google | pay-as-you-go | monthly |
| `google-pro-3.1-tokens-input` | 0.0004 | 1 token | Google | pay-as-you-go | monthly |
| `google-pro-3.1-tokens-output` | 0.0024 | 1 token | Google | pay-as-you-go | monthly |
| `google-search-query` | 2.8 | 1 search query | Google | pay-as-you-go | monthly |
| `instantly-contact-uploaded` | 9.4 | 1 contact | Instantly | growth | monthly |
| `instantly-account-email-sent` | 3.3334 | 1 email | Instantly | growth | monthly |
| `instantly-domain-email-sent` | 0.3968 | 1 email | Instantly | growth | yearly |
| `instantly-contact-uploaded` | 0.776 | 1 contact | Instantly | hypergrowth | monthly |
| `instantly-account-email-sent` | 3.3334 | 1 email | Instantly | hypergrowth | monthly |
| `instantly-domain-email-sent` | 0.3968 | 1 email | Instantly | hypergrowth | monthly |
| `scrape-do-credit` | 0.0232 | 1 API credit (quantity from `scrape.do-request-cost` header) | Scrape.do | hobby | monthly |
| `serper-dev-query` | 0.2 | 1 query | Serper.dev | pay-as-you-go | monthly |
| `twilio-sms-segment` | 2.66 | 1 SMS segment | Twilio | pay-as-you-go | monthly |

### Naming convention

```
{provider}-{service-or-model}-{unit-type}
```

Examples: `apollo-credit`, `anthropic-opus-4.5-tokens-input`, `postmark-email-send`

## Platform costs

Each provider has an active platform cost config that determines which cost tier is used for billing. The `GET /v1/platform-prices/:name` endpoint resolves prices via the active platform cost — no fallbacks.

| Provider | Current Plan | Billing |
|---|---|---|
| apollo | basic | monthly |
| anthropic | pay-as-you-go | monthly |
| firecrawl | hobby | monthly |
| google | pay-as-you-go | monthly |
| instantly | hypergrowth | monthly |
| postmark | pro-10k | monthly |
| scrape-do | hobby | monthly |
| serper-dev | pay-as-you-go | monthly |
| twilio | pay-as-you-go | monthly |

## API

### Platform prices (consumer-facing)

Consumer endpoints for getting resolved platform prices. No auth required. These resolve the provider cost via the active platform cost config — consumers don't need to know about plans.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/platform-prices` | No | List current platform price for every cost name |
| GET | `/v1/platform-prices/:name` | No | Get current platform price for one cost name |

### Providers costs (catalog)

Admin endpoints for managing provider cost data. Write endpoints require `x-api-key` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/providers-costs` | No | List all provider costs (resolved via platform plan) |
| GET | `/v1/providers-costs/:name` | No | Get current provider cost for one name (resolved via platform plan) |
| GET | `/v1/providers-costs/:name/history` | No | Get all historical prices for a cost name |
| GET | `/v1/providers-costs/:name/plans` | No | List all known plan options for a cost name |
| PUT | `/v1/providers-costs/:name` | Yes | Insert a new price point |
| DELETE | `/v1/providers-costs/:name` | Yes | Delete all entries for a cost name |

#### PUT /v1/providers-costs/:name body

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

### Platform costs

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/platform-costs` | No | List current cost config per provider |
| GET | `/v1/platform-costs/:provider` | No | Get current cost config for a provider |
| GET | `/v1/platform-costs/:provider/history` | No | Cost config change history for a provider |
| PUT | `/v1/platform-costs/:provider` | Yes | Set/update cost config for a provider |

#### PUT /v1/platform-costs/:provider body

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
