# costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning.

**Stack:** Express + Drizzle ORM + PostgreSQL

## Unit costs catalog

| Name | Cost (USD cents/unit) | Unit | Provider |
|---|---|---|---|
| `apollo-search-credit` | 0.00 | 1 search credit | Apollo |
| `apollo-enrichment-credit` | 0.98 | 1 enrichment credit | Apollo |
| `anthropic-opus-4.5-tokens-input` | 0.0005 | 1 token | Anthropic |
| `anthropic-opus-4.5-tokens-output` | 0.0025 | 1 token | Anthropic |
| `anthropic-sonnet-4.5-tokens-input` | 0.0003 | 1 token | Anthropic |
| `anthropic-sonnet-4.5-tokens-output` | 0.0015 | 1 token | Anthropic |
| `anthropic-haiku-4.5-tokens-input` | 0.0001 | 1 token | Anthropic |
| `anthropic-haiku-4.5-tokens-output` | 0.0005 | 1 token | Anthropic |
| `postmark-email-send` | 0.18 | 1 email | Postmark |

### Naming convention

```
{provider}-{service-or-model}-{unit-type}
```

Examples: `apollo-enrichment-credit`, `anthropic-opus-4.5-tokens-input`, `postmark-email-send`

## API

All endpoints are prefixed with `/v1/costs`. Write endpoints require `x-api-key` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/costs` | No | List current price for every cost name |
| GET | `/v1/costs/:name` | No | Get current price for one cost name |
| GET | `/v1/costs/:name/history` | No | Get all historical prices for a cost name |
| PUT | `/v1/costs/:name` | Yes | Insert a new price point |
| DELETE | `/v1/costs/:name` | Yes | Delete all entries for a cost name |
| GET | `/health` | No | Health check |

### PUT body

```json
{
  "costPerUnitInUsdCents": 0.0005,
  "effectiveFrom": "2025-06-01T00:00:00Z"
}
```

`effectiveFrom` defaults to now if omitted.

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
