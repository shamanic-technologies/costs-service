# costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning and multi-plan support.

**Stack:** Express + Drizzle ORM + PostgreSQL

## Unit costs catalog

All provider seed costs apply `COST_RISK_MULTIPLIER = 2` to cover cost risk.

| Name | Cost (USD cents/unit) | Unit | Type | Provider | Domain | Plan | Billing |
|---|---|---|---|---|---|---|---|
| `apollo-credit` | 4.72 | credit | Credit | apollo | apollo.io | basic | monthly |
| `apify-ahrefs-result` | 1 | result | Ahrefs scrape result | apify | apify.com | starter | monthly |
| `apify-pipelinelabs-lead` | 0.2 | lead | PipelineLabs lead | apify | apify.com | starter | monthly |
| `apify-microworlds-lead` | 0.32 | lead | MicroWorlds lead | apify | apify.com | starter | monthly |
| `apify-clearpath-lead` | 3 | lead | ClearPath lead | apify | apify.com | starter | monthly |
| `apify-pipelinelabs-actor-start` | 0.002 | run | PipelineLabs actor start | apify | apify.com | starter | monthly |
| `apify-bounceverify-email` | 0.178 | email | BounceVerify email | apify | apify.com | starter | monthly |
| `anthropic-opus-4.5-tokens-input` | 0.001 | 1M tokens | Input tokens (Opus 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-opus-4.5-tokens-output` | 0.005 | 1M tokens | Output tokens (Opus 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-sonnet-4.5-tokens-input` | 0.0006 | 1M tokens | Input tokens (Sonnet 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-sonnet-4.5-tokens-output` | 0.003 | 1M tokens | Output tokens (Sonnet 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-sonnet-4.6-tokens-input` | 0.0006 | 1M tokens | Input tokens (Sonnet 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-sonnet-4.6-tokens-output` | 0.003 | 1M tokens | Output tokens (Sonnet 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-opus-4.6-tokens-input` | 0.001 | 1M tokens | Input tokens (Opus 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-opus-4.6-tokens-output` | 0.005 | 1M tokens | Output tokens (Opus 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-haiku-4.5-tokens-input` | 0.0002 | 1M tokens | Input tokens (Haiku 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-haiku-4.5-tokens-output` | 0.001 | 1M tokens | Output tokens (Haiku 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly |
| `anthropic-web-search` | 2 | search | Web search | anthropic | anthropic.com | pay-as-you-go | monthly |
| `featured-api-pitch-submit` | 200 | call | API call (pitch submit) | featured | featured.com | pay-as-you-go | monthly |
| `postmark-email-send` | 0.3 | email | Email send | postmark | postmarkapp.com | basic-10k | monthly |
| `postmark-email-send` | 0.33 | email | Email send | postmark | postmarkapp.com | pro-10k | monthly |
| `postmark-email-send` | 0.36 | email | Email send | postmark | postmarkapp.com | platform-10k | monthly |
| `firecrawl-scrape-credit` | 1.2666666666 | credit | Scrape credit | firecrawl | firecrawl.dev | hobby | monthly |
| `firecrawl-map-credit` | 1.2666666666 | credit | Map credit | firecrawl | firecrawl.dev | hobby | monthly |
| `firecrawl-extract-token` | 0.0844444444 | token | Extract token | firecrawl | firecrawl.dev | hobby | monthly |
| `google-flash-3-tokens-input` | 0.0001 | 1M tokens | Input tokens (Gemini 3 Flash) | google | google.com | pay-as-you-go | monthly |
| `google-flash-3-tokens-output` | 0.0006 | 1M tokens | Output tokens (Gemini 3 Flash) | google | google.com | pay-as-you-go | monthly |
| `google-flash-3.5-tokens-input` | 0.0003 | 1M tokens | Input tokens (Gemini 3.5 Flash) | google | google.com | pay-as-you-go | monthly |
| `google-flash-3.5-tokens-output` | 0.0018 | 1M tokens | Output tokens (Gemini 3.5 Flash) | google | google.com | pay-as-you-go | monthly |
| `google-flash-image-3.1-tokens-input` | 0.0001 | 1M tokens | Input tokens (Gemini 3.1 Flash Image) | google | google.com | pay-as-you-go | monthly |
| `google-flash-image-3.1-tokens-output` | 0.012 | 1M tokens | Image output tokens (Gemini 3.1 Flash Image) | google | google.com | pay-as-you-go | monthly |
| `google-flash-2.5-tokens-input` | 0.00006 | 1M tokens | Input tokens (Gemini 2.5 Flash) | google | google.com | pay-as-you-go | monthly |
| `google-flash-2.5-tokens-output` | 0.0005 | 1M tokens | Output tokens (Gemini 2.5 Flash) | google | google.com | pay-as-you-go | monthly |
| `google-flash-lite-2.5-tokens-input` | 0.00002 | 1M tokens | Input tokens (Gemini 2.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly |
| `google-flash-lite-2.5-tokens-output` | 0.00008 | 1M tokens | Output tokens (Gemini 2.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly |
| `google-flash-lite-3.1-tokens-input` | 0.00005 | 1M tokens | Input tokens (Gemini 3.1 Flash Lite) | google | google.com | pay-as-you-go | monthly |
| `google-flash-lite-3.1-tokens-output` | 0.0003 | 1M tokens | Output tokens (Gemini 3.1 Flash Lite) | google | google.com | pay-as-you-go | monthly |
| `google-pro-2.5-tokens-input` | 0.00025 | 1M tokens | Input tokens (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly |
| `google-pro-2.5-tokens-output` | 0.002 | 1M tokens | Output tokens (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly |
| `google-pro-3.1-tokens-input` | 0.0004 | 1M tokens | Input tokens (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly |
| `google-pro-3.1-tokens-output` | 0.0024 | 1M tokens | Output tokens (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly |
| `google-embedding-001-tokens-input` | 0.00003 | 1M tokens | Input tokens (Gemini Embedding 001) | google | google.com | pay-as-you-go | monthly |
| `google-search-query` | 2.8 | query | Search query (grounding) | google | google.com | pay-as-you-go | monthly |
| `instantly-contact-uploaded` | 9.4 | contact | Contact upload | instantly | instantly.ai | growth | monthly |
| `instantly-account-email-sent` | 1.4285714286 | email | Email send (per account) | instantly | instantly.ai | growth | monthly |
| `instantly-domain-email-sent` | 0.5158730158 | email | Email send (per domain) | instantly | instantly.ai | growth | yearly |
| `instantly-contact-uploaded` | 0.776 | contact | Contact upload | instantly | instantly.ai | hypergrowth | monthly |
| `instantly-account-email-sent` | 1.4285714286 | email | Email send (per account) | instantly | instantly.ai | hypergrowth | monthly |
| `instantly-domain-email-sent` | 0.5158730158 | email | Email send (per domain) | instantly | instantly.ai | hypergrowth | monthly |
| `scrape-do-credit` | 0.0232 | credit | Scrape credit | scrape-do | scrape.do | hobby | monthly |
| `serper-dev-query` | 0.2 | query | Search query | serper-dev | serper.dev | pay-as-you-go | monthly |
| `stripe-processing-fee` | 2 | USD cent | Charge processing fee | stripe | stripe.com | pay-as-you-go | monthly |
| `stripe-refund-fee` | 2 | USD cent | Refund fee | stripe | stripe.com | pay-as-you-go | monthly |
| `stripe-dispute-fee` | 2 | USD cent | Dispute fee | stripe | stripe.com | pay-as-you-go | monthly |
| `stripe-payout-failure-fee` | 2 | USD cent | Payout failure fee | stripe | stripe.com | pay-as-you-go | monthly |
| `twilio-sms-segment` | 2.66 | segment | SMS message | twilio | twilio.com | pay-as-you-go | monthly |
| `cloudflare-r2-class-a-operation` | 0.0009 | operation | R2 Class A operation | cloudflare | cloudflare.com | pay-as-you-go | monthly |
| `cloudflare-r2-class-b-operation` | 0.000072 | operation | R2 Class B operation | cloudflare | cloudflare.com | pay-as-you-go | monthly |

`Domain` powers the public pricing page logo (logo.dev). `Type` is the human-readable cost-type label used for grouping. `Unit` is what one billed unit represents. A Twilio SMS over 160 characters splits into multiple segments — pricing is per segment.

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
| apify | starter | monthly |
| anthropic | pay-as-you-go | monthly |
| cloudflare | pay-as-you-go | monthly |
| featured | pay-as-you-go | monthly |
| firecrawl | hobby | monthly |
| google | pay-as-you-go | monthly |
| instantly | hypergrowth | monthly |
| postmark | pro-10k | monthly |
| scrape-do | hobby | monthly |
| serper-dev | pay-as-you-go | monthly |
| stripe | pay-as-you-go | monthly |
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
  "providerDomain": "anthropic.com",
  "type": "Input tokens (Sonnet 4.6)",
  "unit": "1M tokens",
  "planTier": "pay-as-you-go",
  "billingCycle": "monthly",
  "effectiveFrom": "2025-06-01T00:00:00Z"
}
```

Required: `costPerUnitInUsdCents`, `provider`, `type`, `unit`, `planTier`, `billingCycle`. Optional: `providerDomain` (used for logo.dev on the public pricing page), `effectiveFrom` (defaults to now).

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
