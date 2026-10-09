# costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning and multi-plan support.

**Stack:** Express + Drizzle ORM + PostgreSQL

## Unit costs catalog

> **Billed price = the proposed price list (since 2026-10-02).** The values in the table below are the SEED versions (vendor rate x 5 for `marked-up`, vendor rate for `pass-through`). After every daily real-cost refresh, each cost item's proposed price of the day (real cost x2 for production tools, x1 for Stripe and media; email infrastructure and subscriptions averaged, subscription credits floored at the vendor list cost, APIs at vendor list cost, all excluding VAT) is appended as a new `proposed-list` price version, effective at that instant, whenever it differs from the price in force. That is what `GET /v1/platform-prices/:name` serves and runs-service charges. Never retroactive: a cost row keeps the price it froze. An item with no proposed price keeps its current price (flagged); only a unit declared included at the vendor (`instantly-contact-uploaded`, `apollo-search-credit`) is billed 0. A stale proposed list or a failed refresh writes nothing (`GET /internal/catalogue-syncs`). Rules: `src/lib/price-lists.ts`, `src/lib/real-cost.ts`, `src/lib/catalogue-sync.ts`.

Every line states its **basis**, and there are only two:

- **`marked-up`** — work we perform (LLM tokens, embeddings, enrichment, search, creative generation). Price = the vendor rate × `COST_RISK_MULTIPLIER = 2` × `COST_PROFIT_MULTIPLIER = 2.5` = **5×** (risk covers cost under-estimation; profit is the store margin).
  The "vendor rate" is what the invoice says, which is not always what the price list says: DeepSeek adds 6% Chinese VAT on top of every top-up, and that VAT cannot be reclaimed through an EU VAT return, so it is part of the cost rather than a tax we advance. `withChinaVat` raises the published cell before the markup is taken. It is applied to DeepSeek only — Z.ai and Moonshot invoices carry no VAT line, and the test for adding it is an invoice, not the vendor's nationality.
- **`pass-through`** — money we merely route: advertising-platform spend and payment-processing fees. Price **is** the vendor rate. A customer who brings their own creatives pays exactly what the underlying platform charges and nothing more.

The basis is on the row and on every public price read (`GET /v1/platform-prices`, `GET /v1/platform-prices/:name`), so a caller — the public pricing page included — can tell the two apart without keeping its own list of names. The column is `NOT NULL` and the write paths require it: a line whose class cannot be resolved fails loudly rather than defaulting to either side.

### Retired names (`status: "retired"`)

Every public price read (`GET /v1/platform-prices`, `GET /v1/platform-prices/:name`) carries `status` (`current` | `retired`) and `supersededBy`. A **retired** name is one no service of ours emits any more (a replaced model, a renamed or merged unit, e.g. `instantly-email-send` → `instantly-account-email-sent` + `instantly-domain-email-sent`). It keeps its price, so spend already declared against it still resolves, but a public price list shows only `current` lines. Idle is not retired: a selectable model or an opt-in tool nobody used this month stays `current`. The list is declared in `src/lib/retired-cost-names.ts`, written in the same PR that seeds or adopts the successor.

### Last use and bundles (list only)

Each `GET /v1/platform-prices` row also carries:
- `lastUsedOn`: the last UTC day any run used the name (from runs-service consumption, read by the daily refresh; `null` = never), and `usageReadAt`, when that usage was read. Measure idleness against `usageReadAt`, not today.
- `bundle`: set when the row is only part of one outcome a client pays for. One email sent is one `instantly-account-email-sent` unit plus one `instantly-domain-email-sent` unit, so both rows carry `bundle: { name: "email-sent", unit: "email", pricePerUnitInUsdCents }` with the price of the whole email. Declared in `src/lib/price-bundles.ts`.

### Delisted lines (no billable price)

A line can also have **no price at all**. When a cost we still incur stops being rebilled to customers, its newest version carries a `null` price: it leaves this table and `GET /v1/platform-prices`, while `GET /v1/platform-prices/:name` still answers `200` with `pricePerUnitInUsdCents: null` and `billable: false`, and `/v1/providers-costs/:name/history` still returns every price it ever had. Nothing is deleted and nothing is re-priced — spend already declared against the name reads back at the price it was written with.

`null` is not `0`: a zero would claim the line is free, and it is not. We still pay for it; we stopped passing it on.

Delisted 2026-08 — the cold-email infrastructure (Instantly subscriptions, MailForge, PrimeForge, the Claude Max seat) moved onto our own fixed costs, and the markup on everything we still rebill went from 4× to 5× to keep the unit economics flat:

| Cost name | Delisted | Was |
|---|---|---|
| `instantly-contact-uploaded` | 2026-08 | 1.552 USD cents/contact |
| `instantly-account-email-sent` | 2026-08 | 6.548148148 USD cents/email |
| `instantly-domain-email-sent` | 2026-08 | 0.1587301588 USD cents/email |

The `instantly` platform-cost row below is deliberately KEPT: without an active plan for the provider, every by-name read of these three names would 500 instead of resolving.

A routed line is priced at **1 cent per USD cent of vendor spend**, so the consumer reports `quantity` = the amount the platform charged, in cents, and the org is charged that amount exactly. Generating the creative for one of those campaigns is a separate, marked-up line — buying the placement is routing, making the ad is work.

| Name | Cost (USD cents/unit) | Unit | Type | Provider | Domain | Plan | Billing | Basis |
|---|---|---|---|---|---|---|---|---|
| `apollo-credit` | 11.8 | credit | Credit | apollo | apollo.io | basic | monthly | marked-up |
| `apify-ahrefs-result` | 2.5 | result | Ahrefs scrape result | apify | apify.com | starter | monthly | marked-up |
| `apify-pipelinelabs-lead` | 0.5 | lead | PipelineLabs lead | apify | apify.com | starter | monthly | marked-up |
| `apify-microworlds-lead` | 0.8 | lead | MicroWorlds lead | apify | apify.com | starter | monthly | marked-up |
| `apify-clearpath-lead` | 7.5 | lead | ClearPath lead | apify | apify.com | starter | monthly | marked-up |
| `apify-pipelinelabs-actor-start` | 0.005 | run | PipelineLabs actor start | apify | apify.com | starter | monthly | marked-up |
| `apify-bounceverify-email` | 0.445 | email | BounceVerify email | apify | apify.com | starter | monthly | marked-up |
| `explee-credit` | 4.9 | credit | Credit | explee | explee.com | starter | monthly | marked-up |
| `treg-micro-usd` | 0.0005 | micro-USD | treg provider charge | treg | treg.to | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-4.5-tokens-input` | 0.0025 | 1M tokens | Input tokens (Opus 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-4.5-tokens-output` | 0.0125 | 1M tokens | Output tokens (Opus 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-4.5-tokens-input` | 0.0015 | 1M tokens | Input tokens (Sonnet 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-4.5-tokens-output` | 0.0075 | 1M tokens | Output tokens (Sonnet 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-4.6-tokens-input` | 0.0015 | 1M tokens | Input tokens (Sonnet 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-4.6-tokens-output` | 0.0075 | 1M tokens | Output tokens (Sonnet 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-4.6-tokens-input` | 0.0025 | 1M tokens | Input tokens (Opus 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-4.6-tokens-output` | 0.0125 | 1M tokens | Output tokens (Opus 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-4.5-tokens-input` | 0.0005 | 1M tokens | Input tokens (Haiku 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-4.5-tokens-output` | 0.0025 | 1M tokens | Output tokens (Haiku 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-fable-5.1-tokens-input` | 0.005 | 1M tokens | Input tokens (Fable 5.1) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-fable-5.1-tokens-cached-input` | 0.000125 | 1M tokens | Cached input tokens (Fable 5.1) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-fable-5.1-tokens-cache-write-5m` | 0.00625 | 1M tokens | Cache write tokens, 5-minute TTL (Fable 5.1) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-fable-5.1-tokens-output` | 0.025 | 1M tokens | Output tokens (Fable 5.1) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-5.5-tokens-input` | 0.001 | 1M tokens | Input tokens (Sonnet 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-5.5-tokens-cached-input` | 0.00005 | 1M tokens | Cached input tokens (Sonnet 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-5.5-tokens-cache-write-5m` | 0.00125 | 1M tokens | Cache write tokens, 5-minute TTL (Sonnet 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-5.5-tokens-output` | 0.005 | 1M tokens | Output tokens (Sonnet 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-5.5-tokens-input` | 0.002 | 1M tokens | Input tokens (Opus 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-5.5-tokens-cached-input` | 0.0001 | 1M tokens | Cached input tokens (Opus 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-5.5-tokens-cache-write-5m` | 0.0025 | 1M tokens | Cache write tokens, 5-minute TTL (Opus 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-5.5-tokens-output` | 0.01 | 1M tokens | Output tokens (Opus 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-5.5-tokens-input` | 0.00005 | 1M tokens | Input tokens (Haiku 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-5.5-tokens-cached-input` | 0.000005 | 1M tokens | Cached input tokens (Haiku 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-5.5-tokens-cache-write-5m` | 0.0000625 | 1M tokens | Cache write tokens, 5-minute TTL (Haiku 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-5.5-tokens-output` | 0.00025 | 1M tokens | Output tokens (Haiku 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-5.5-long-context-tokens-input` | 0.00025 | 1M tokens | Input tokens, prompt over 100k (Haiku 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-5.5-long-context-tokens-cached-input` | 0.000025 | 1M tokens | Cached input tokens, prompt over 100k (Haiku 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-5.5-long-context-tokens-cache-write-5m` | 0.0003125 | 1M tokens | Cache write tokens, 5-minute TTL, prompt over 100k (Haiku 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-5.5-long-context-tokens-output` | 0.00125 | 1M tokens | Output tokens, prompt over 100k (Haiku 5.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-web-search` | 5 | search | Web search | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `featured-api-pitch-submit` | 0.25 | call | API call (pitch submit) | featured | featured.com | pay-as-you-go | monthly | marked-up |
| `postmark-email-send` | 0.75 | email | Email send | postmark | postmarkapp.com | basic-10k | monthly | marked-up |
| `postmark-email-send` | 0.825 | email | Email send | postmark | postmarkapp.com | pro-10k | monthly | marked-up |
| `postmark-email-send` | 0.9 | email | Email send | postmark | postmarkapp.com | platform-10k | monthly | marked-up |
| `firecrawl-scrape-credit` | 3.1666666665 | credit | Scrape credit | firecrawl | firecrawl.dev | hobby | monthly | marked-up |
| `firecrawl-map-credit` | 3.1666666665 | credit | Map credit | firecrawl | firecrawl.dev | hobby | monthly | marked-up |
| `firecrawl-extract-token` | 0.211111111 | token | Extract token | firecrawl | firecrawl.dev | hobby | monthly | marked-up |
| `google-flash-3-tokens-input` | 0.00025 | 1M tokens | Input tokens (Gemini 3 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3-tokens-output` | 0.0015 | 1M tokens | Output tokens (Gemini 3 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.5-tokens-input` | 0.00075 | 1M tokens | Input tokens (Gemini 3.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.5-tokens-output` | 0.0045 | 1M tokens | Output tokens (Gemini 3.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.6-tokens-input` | 0.00075 | 1M tokens | Input tokens (Gemini 3.6 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.6-tokens-output` | 0.00375 | 1M tokens | Output tokens (Gemini 3.6 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.7-tokens-input` | 0.00075 | 1M tokens | Input tokens (Gemini 3.7 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.7-tokens-output` | 0.00375 | 1M tokens | Output tokens (Gemini 3.7 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.8-tokens-input` | 0.00075 | 1M tokens | Input tokens (Gemini 3.8 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.8-tokens-output` | 0.00375 | 1M tokens | Output tokens (Gemini 3.8 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.5-tokens-input` | 0.00015 | 1M tokens | Input tokens (Gemini 3.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.5-tokens-output` | 0.00125 | 1M tokens | Output tokens (Gemini 3.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-image-3.1-tokens-input` | 0.00025 | 1M tokens | Input tokens (Gemini 3.1 Flash Image) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-image-3.1-tokens-output` | 0.03 | 1M tokens | Image output tokens (Gemini 3.1 Flash Image) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-2.5-tokens-input` | 0.00015 | 1M tokens | Input tokens (Gemini 2.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-2.5-tokens-output` | 0.00125 | 1M tokens | Output tokens (Gemini 2.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-2.5-tokens-input` | 0.00005 | 1M tokens | Input tokens (Gemini 2.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-2.5-tokens-output` | 0.0002 | 1M tokens | Output tokens (Gemini 2.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.1-tokens-input` | 0.000125 | 1M tokens | Input tokens (Gemini 3.1 Flash Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.1-tokens-output` | 0.00075 | 1M tokens | Output tokens (Gemini 3.1 Flash Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-2.5-tokens-input` | 0.000625 | 1M tokens | Input tokens (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-2.5-tokens-output` | 0.005 | 1M tokens | Output tokens (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-3.1-tokens-input` | 0.001 | 1M tokens | Input tokens (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-3.1-tokens-output` | 0.006 | 1M tokens | Output tokens (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-3.1-tokens-cached-input` | 0.0001 | 1M tokens | Cached input tokens (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-2.5-tokens-cached-input` | 0.0000625 | 1M tokens | Cached input tokens (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.8-tokens-cached-input` | 0.000075 | 1M tokens | Cached input tokens (Gemini 3.8 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.7-tokens-cached-input` | 0.000075 | 1M tokens | Cached input tokens (Gemini 3.7 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.6-tokens-cached-input` | 0.000075 | 1M tokens | Cached input tokens (Gemini 3.6 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.5-tokens-cached-input` | 0.000075 | 1M tokens | Cached input tokens (Gemini 3.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3-tokens-cached-input` | 0.000025 | 1M tokens | Cached input tokens (Gemini 3 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.5-tokens-cached-input` | 0.000015 | 1M tokens | Cached input tokens (Gemini 3.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.1-tokens-cached-input` | 0.0000125 | 1M tokens | Cached input tokens (Gemini 3.1 Flash Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-2.5-tokens-cached-input` | 0.000015 | 1M tokens | Cached input tokens (Gemini 2.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-2.5-tokens-cached-input` | 0.000005 | 1M tokens | Cached input tokens (Gemini 2.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-3.1-long-context-tokens-input` | 0.002 | 1M tokens | Input tokens, prompt over 200k (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-3.1-long-context-tokens-cached-input` | 0.0002 | 1M tokens | Cached input tokens, prompt over 200k (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-3.1-long-context-tokens-output` | 0.009 | 1M tokens | Output tokens, prompt over 200k (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-2.5-long-context-tokens-input` | 0.00125 | 1M tokens | Input tokens, prompt over 200k (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-2.5-long-context-tokens-cached-input` | 0.000125 | 1M tokens | Cached input tokens, prompt over 200k (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-2.5-long-context-tokens-output` | 0.0075 | 1M tokens | Output tokens, prompt over 200k (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-image-3.1-tokens-text-output` | 0.0015 | 1M tokens | Text and thinking output tokens (Gemini 3.1 Flash Image) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-embedding-001-tokens-input` | 0.000075 | 1M tokens | Input tokens (Gemini Embedding 001) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-search-query` | 7 | query | Search query (grounding) | google | google.com | pay-as-you-go | monthly | marked-up |
| `scrape-do-credit` | 0.058 | credit | Scrape credit | scrape-do | scrape.do | hobby | monthly | marked-up |
| `serper-dev-query` | 0.5 | query | Search query | serper-dev | serper.dev | pay-as-you-go | monthly | marked-up |
| `stripe-processing-fee` | 1 | USD cent | Charge processing fee | stripe | stripe.com | pay-as-you-go | monthly | pass-through |
| `stripe-refund-fee` | 1 | USD cent | Refund fee | stripe | stripe.com | pay-as-you-go | monthly | pass-through |
| `stripe-dispute-fee` | 1 | USD cent | Dispute fee | stripe | stripe.com | pay-as-you-go | monthly | pass-through |
| `stripe-payout-failure-fee` | 1 | USD cent | Payout failure fee | stripe | stripe.com | pay-as-you-go | monthly | pass-through |
| `revolut-acquiring-fee` | 1 | USD cent | Card acquiring fee | revolut | revolut.com | pay-as-you-go | monthly | pass-through |
| `twilio-sms-segment` | 6.65 | segment | SMS message | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `twilio-whatsapp-message` | 2.5 | message | WhatsApp message | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `twilio-voice-outbound-minute-us` | 7 | minute | Outbound voice minute (US) | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `twilio-voice-outbound-minute-fr-landline` | 9.35 | minute | Outbound voice minute (France, landline) | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `twilio-voice-outbound-minute-fr-mobile` | 80.15 | minute | Outbound voice minute (France, mobile) | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `twilio-voice-outbound-minute-lc-landline` | 241.5 | minute | Outbound voice minute (St Lucia, landline) | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `twilio-voice-outbound-minute-lc-mobile` | 357.9 | minute | Outbound voice minute (St Lucia, mobile) | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `cloudflare-r2-class-a-operation` | 0.00225 | operation | R2 Class A operation | cloudflare | cloudflare.com | pay-as-you-go | monthly | marked-up |
| `cloudflare-r2-class-b-operation` | 0.00018 | operation | R2 Class B operation | cloudflare | cloudflare.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-tokens-input` | 0.00007 | 1M tokens | Input tokens (DeepSeek V4 Flash) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-tokens-output` | 0.00014 | 1M tokens | Output tokens (DeepSeek V4 Flash) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-tokens-input` | 0.0002175 | 1M tokens | Input tokens (DeepSeek V4 Pro) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-tokens-output` | 0.000435 | 1M tokens | Output tokens (DeepSeek V4 Pro) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-input` | 0.0000742 | 1M tokens | Input tokens (DeepSeek V4 Flash, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-input` | 0.0002332 | 1M tokens | Input tokens (DeepSeek V4 Flash, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-cached-input` | 0.000001484 | 1M tokens | Cached input tokens (DeepSeek V4 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-cached-input` | 0.00000742 | 1M tokens | Cached input tokens (DeepSeek V4 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-output` | 0.0001484 | 1M tokens | Output tokens (DeepSeek V4 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-output` | 0.0006996 | 1M tokens | Output tokens (DeepSeek V4 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-input` | 0.0000742 | 1M tokens | Input tokens (DeepSeek V4 Flash, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-input` | 0.0001166 | 1M tokens | Input tokens (DeepSeek V4 Flash, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-cached-input` | 0.000001484 | 1M tokens | Cached input tokens (DeepSeek V4 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-cached-input` | 0.00000371 | 1M tokens | Cached input tokens (DeepSeek V4 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-output` | 0.0001484 | 1M tokens | Output tokens (DeepSeek V4 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-output` | 0.0003498 | 1M tokens | Output tokens (DeepSeek V4 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-input` | 0.00023055 | 1M tokens | Input tokens (DeepSeek V4 Pro, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-input` | 0.0006996 | 1M tokens | Input tokens (DeepSeek V4 Pro, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-cached-input` | 0.0000019215 | 1M tokens | Cached input tokens (DeepSeek V4 Pro, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-cached-input` | 0.00002332 | 1M tokens | Cached input tokens (DeepSeek V4 Pro, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-output` | 0.0004611 | 1M tokens | Output tokens (DeepSeek V4 Pro, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-output` | 0.0020988 | 1M tokens | Output tokens (DeepSeek V4 Pro, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-input` | 0.00023055 | 1M tokens | Input tokens (DeepSeek V4 Pro, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-input` | 0.0003498 | 1M tokens | Input tokens (DeepSeek V4 Pro, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-cached-input` | 0.0000019215 | 1M tokens | Cached input tokens (DeepSeek V4 Pro, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-cached-input` | 0.00001166 | 1M tokens | Cached input tokens (DeepSeek V4 Pro, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-output` | 0.0004611 | 1M tokens | Output tokens (DeepSeek V4 Pro, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-output` | 0.0010494 | 1M tokens | Output tokens (DeepSeek V4 Pro, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4.1-flash-peak-tokens-input` | 0.000159 | 1M tokens | Input tokens (DeepSeek V4.1 Flash, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4.1-flash-peak-tokens-cached-input` | 0.00000318 | 1M tokens | Cached input tokens (DeepSeek V4.1 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4.1-flash-peak-tokens-output` | 0.000636 | 1M tokens | Output tokens (DeepSeek V4.1 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4.1-flash-off-peak-tokens-input` | 0.0000795 | 1M tokens | Input tokens (DeepSeek V4.1 Flash, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4.1-flash-off-peak-tokens-cached-input` | 0.00000159 | 1M tokens | Cached input tokens (DeepSeek V4.1 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4.1-flash-off-peak-tokens-output` | 0.000318 | 1M tokens | Output tokens (DeepSeek V4.1 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `zai-glm-4.7-flashx-tokens-input` | 0.000035 | 1M tokens | Input tokens (GLM-4.7-FlashX) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-4.7-flashx-tokens-cached-input` | 0.000005 | 1M tokens | Cached input tokens (GLM-4.7-FlashX) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-4.7-flashx-tokens-output` | 0.0002 | 1M tokens | Output tokens (GLM-4.7-FlashX) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.2-tokens-input` | 0.0007 | 1M tokens | Input tokens (GLM-5.2) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.2-tokens-cached-input` | 0.00013 | 1M tokens | Cached input tokens (GLM-5.2) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.2-tokens-output` | 0.0022 | 1M tokens | Output tokens (GLM-5.2) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-tokens-input` | 0.0007 | 1M tokens | Input tokens (GLM-5.3) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-tokens-cached-input` | 0.00013 | 1M tokens | Cached input tokens (GLM-5.3) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-tokens-output` | 0.0022 | 1M tokens | Output tokens (GLM-5.3) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-flash-tokens-input` | 0.000075 | 1M tokens | Input tokens (GLM-5.3-Flash) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-flash-tokens-cached-input` | 0.000015 | 1M tokens | Cached input tokens (GLM-5.3-Flash) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-flash-tokens-output` | 0.00025 | 1M tokens | Output tokens (GLM-5.3-Flash) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k2.6-tokens-input` | 0.000475 | 1M tokens | Input tokens (Kimi K2.6) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k2.6-tokens-cached-input` | 0.00008 | 1M tokens | Cached input tokens (Kimi K2.6) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k2.6-tokens-output` | 0.002 | 1M tokens | Output tokens (Kimi K2.6) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k3-tokens-input` | 0.0015 | 1M tokens | Input tokens (Kimi K3) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k3-tokens-cached-input` | 0.00015 | 1M tokens | Cached input tokens (Kimi K3) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k3-tokens-output` | 0.0075 | 1M tokens | Output tokens (Kimi K3) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `openai-gpt-6-astra-tokens-input` | 0.005 | 1M tokens | Input tokens (GPT-6 Astra) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-6-astra-tokens-cached-input` | 0.0005 | 1M tokens | Cached input tokens (GPT-6 Astra) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-6-astra-tokens-output` | 0.025 | 1M tokens | Output tokens (GPT-6 Astra) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-6-sol-tokens-input` | 0.001 | 1M tokens | Input tokens (GPT-6 Sol) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-6-sol-tokens-cached-input` | 0.0001 | 1M tokens | Cached input tokens (GPT-6 Sol) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-6-sol-tokens-output` | 0.005 | 1M tokens | Output tokens (GPT-6 Sol) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-5.6-sol-tokens-input` | 0.002 | 1M tokens | Input tokens (GPT-5.6 Sol) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-5.6-sol-tokens-cached-input` | 0.0002 | 1M tokens | Cached input tokens (GPT-5.6 Sol) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-5.6-sol-tokens-output` | 0.01 | 1M tokens | Output tokens (GPT-5.6 Sol) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-5.6-terra-tokens-input` | 0.001 | 1M tokens | Input tokens (GPT-5.6 Terra) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-5.6-terra-tokens-cached-input` | 0.0001 | 1M tokens | Cached input tokens (GPT-5.6 Terra) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `openai-gpt-5.6-terra-tokens-output` | 0.006 | 1M tokens | Output tokens (GPT-5.6 Terra) | openai | openai.com | pay-as-you-go | monthly | marked-up |
| `typesafe-jev-1.13-tokens-input` | 0.000021 | 1M tokens | Input tokens (Jev 1.13) | typesafe | typesafe.ai | pay-as-you-go | monthly | marked-up |
| `x-post-create` | 7.5 | post | X API v2 post create (pay-per-use) | x | x.com | pay-as-you-go | monthly | marked-up |
| `x-post-create-with-url` | 100 | post | X API v2 post create with URL (pay-per-use) | x | x.com | pay-as-you-go | monthly | marked-up |
| `google-ads-spend` | 1 | USD cent | Google Ads platform spend | google-ads | ads.google.com | pay-as-you-go | monthly | pass-through |
| `meta-ads-spend` | 1 | USD cent | Meta Ads platform spend | meta-ads | facebook.com | pay-as-you-go | monthly | pass-through |
| `linkedin-ads-spend` | 1 | USD cent | LinkedIn Ads platform spend | linkedin-ads | linkedin.com | pay-as-you-go | monthly | pass-through |
| `tiktok-ads-spend` | 1 | USD cent | TikTok Ads platform spend | tiktok-ads | tiktok.com | pay-as-you-go | monthly | pass-through |
| `youtube-ads-spend` | 1 | USD cent | YouTube Ads platform spend | youtube-ads | youtube.com | pay-as-you-go | monthly | pass-through |
| `x-ads-spend` | 1 | USD cent | X Ads platform spend | x-ads | x.com | pay-as-you-go | monthly | pass-through |
| `reddit-ads-spend` | 1 | USD cent | Reddit Ads platform spend | reddit-ads | reddit.com | pay-as-you-go | monthly | pass-through |
| `bing-ads-spend` | 1 | USD cent | Bing Ads platform spend | bing-ads | bing.com | pay-as-you-go | monthly | pass-through |
| `quora-ads-spend` | 1 | USD cent | Quora Ads platform spend | quora-ads | quora.com | pay-as-you-go | monthly | pass-through |
| `newsletter-sponsorship-spend` | 1 | USD cent | Newsletter sponsorship spend | newsletter-sponsorship |  | pay-as-you-go | monthly | pass-through |
| `podcast-sponsorship-spend` | 1 | USD cent | Podcast sponsorship spend | podcast-sponsorship |  | pay-as-you-go | monthly | pass-through |
| `creator-sponsorship-spend` | 1 | USD cent | Creator sponsorship spend | creator-sponsorship |  | pay-as-you-go | monthly | pass-through |
| `software-directory-listing-spend` | 1 | USD cent | Paid software-directory listing spend | software-directory-listing |  | pay-as-you-go | monthly | pass-through |

`Domain` powers the public pricing page logo (logo.dev). `Type` is the human-readable cost-type label used for grouping. `Unit` is what one billed unit represents. A Twilio SMS over 160 characters splits into multiple segments — pricing is per segment.

### Naming convention

```
{provider}-{service-or-model}-{unit-type}
```

Examples: `apollo-credit`, `anthropic-opus-4.5-tokens-input`, `postmark-email-send`

### Picking the right name for a token spend

A vendor may price the same model along more than one dimension. Every priced dimension is a
separate cost name, so a consumer selects a name and never computes a rate.

**Token class** — the last name segment. `-tokens-input` is an uncached (cache-miss) input
token, `-tokens-cached-input` is a cache-hit input token, `-tokens-output` is an output token.
Vendors return the split in their usage payload; declare each count against its own name.
Cache-hit input is 50x-120x cheaper than a miss at DeepSeek, so declaring a hit against
`-tokens-input` over-charges by that factor.

**Pricing regime** — the segment before `-tokens-…`, present only for a vendor that charges by
the clock. DeepSeek does, from 2026-08-16 16:00 UTC:

| Regime | Windows (UTC) |
|---|---|
| `peak` | `Mon-Fri@01:00-04:00`, `Mon-Fri@06:00-10:00` |
| `off-peak` | `Mon-Fri@00:00-01:00`, `Mon-Fri@04:00-06:00`, `Mon-Fri@10:00-24:00`, `Sat-Sun@00:00-24:00` |

A window is `Days@HH:MM-HH:MM`, half-open on the minute, days as a `Mon`..`Sun` range. The day
scope is part of the grammar because DeepSeek's regime is not purely time-of-day: since
2026-08-23 (00:00 Beijing) off-peak rates apply for the whole day on Saturdays and Sundays.
The Beijing weekend runs Friday 16:00 UTC to Sunday 16:00 UTC, but every peak window sits
between 01:00 and 10:00 UTC — well inside the stretch of a UTC day that shares its weekday with
Beijing — so the rule lands on whole UTC Saturdays and Sundays. That reduction depends on where
the windows sit; if the vendor ever moves one past 16:00 UTC it stops holding.

The windows are on the price itself (`regimeHoursUtc`, alongside `pricingRegime`) in every
`/v1/platform-prices` response, so a consumer reads them rather than hard-coding them.
A vendor's regimes partition the week, so for one model and one token class exactly one name
matches any instant: `deepseek-v4-flash-peak-tokens-cached-input` is a V4 Flash cache-hit input
token spent during peak hours. A vendor with no time-of-day pricing (Z.ai, Anthropic, Google)
has no regime segment and reports `pricingRegime: null`.

The regime names carry two price points: DeepSeek's current uniform rate until
2026-08-16 16:00 UTC, then its peak and off-peak rates. Both are read from the vendor's own
tables. `GET /v1/platform-prices/:name` always serves the one in force at request time, and
prices already declared keep whatever they were written with.

> The regime-free `deepseek-v4-{flash,pro}-tokens-{input,output}` names are **superseded**.
> They are frozen at the pre-2026-08-16 rate and kept only because costs were declared against
> them. DeepSeek has no regime-free rate after that instant, so there is no honest value to
> append to them — consumers must move to the regime names before it.

### DeepSeek V4.1 Flash (released 2026-09-10)

`deepseek-v4.1-flash-{peak,off-peak}-tokens-{input,cached-input,output}`, priced from
**2026-09-10 04:00 UTC**, the instant the vendor states. Its API model id is `deepseek-flash`
(DeepSeek renamed the Flash id in the same release). It carries a single price version: the
model did not exist before that instant, so it never had a regime-free rate. Its peak windows
are DeepSeek's unchanged `Mon-Fri@01:00-04:00,Mon-Fri@06:00-10:00`.

It is a **new model, not a re-price of V4 Flash** — peak cache-miss input is $0.3/1M against
V4 Flash's $0.44/1M — so it gets its own names and every `deepseek-v4-flash-*` row is left
exactly as written.

> **V4 Pro is discontinued at 2026-09-14 04:00 UTC** (12:00 Beijing): from that instant
> DeepSeek routes `deepseek-v4-pro` requests to V4.1 Flash and bills them at the Flash price.
> The `deepseek-v4-pro-*` rows are correct until then and are kept unchanged afterwards, so
> spend already declared against them keeps resolving. Consumers must move to the V4.1 Flash
> names before that instant.

### TypeSafe Jev (typesafe.ai)

`typesafe-jev-1.13-tokens-input` is the **only** TypeSafe cost name, and that is the whole
entry for the vendor. TypeSafe charges $0.042 per 1M input tokens ($42 per Btok) and charges
nothing at all for output tokens, so there is no `-tokens-output` name to declare: a priced
output row would bill a customer for something no invoice carries. There is no cache-hit
dimension and no time-of-day schedule either, so the name carries no regime segment and
`pricingRegime` reads `null`.

The model segment is the release (`jev-1.13`), not an alias. `jev-latest` and `jev-preview`
both point at `jev-1.13.0` today, but an alias moves to a new model without notice while the
response reports the versioned id that answered — a name keyed on the alias would silently
reprice. A new Jev release gets its own name.

Consumers declare the exact input token count the response reports; output counts are not
declared at all.

## Platform costs

Each provider has an active platform cost config that determines which cost tier is used for billing. The `GET /v1/platform-prices/:name` endpoint resolves prices via the active platform cost — no fallbacks.

| Provider | Current Plan | Billing |
|---|---|---|
| apollo | basic | monthly |
| apify | starter | monthly |
| explee | starter | monthly |
| treg | pay-as-you-go | monthly |
| anthropic | pay-as-you-go | monthly |
| cloudflare | pay-as-you-go | monthly |
| deepseek | pay-as-you-go | monthly |
| featured | pay-as-you-go | monthly |
| firecrawl | hobby | monthly |
| google | pay-as-you-go | monthly |
| instantly | hypergrowth | monthly |
| moonshot | pay-as-you-go | monthly |
| openai | pay-as-you-go | monthly |
| postmark | pro-10k | monthly |
| scrape-do | hobby | monthly |
| serper-dev | pay-as-you-go | monthly |
| stripe | pay-as-you-go | monthly |
| revolut | pay-as-you-go | monthly |
| twilio | pay-as-you-go | monthly |
| typesafe | pay-as-you-go | monthly |
| x | pay-as-you-go | monthly |
| zai | pay-as-you-go | monthly |
| google-ads | pay-as-you-go | monthly |
| meta-ads | pay-as-you-go | monthly |
| linkedin-ads | pay-as-you-go | monthly |
| tiktok-ads | pay-as-you-go | monthly |
| youtube-ads | pay-as-you-go | monthly |
| x-ads | pay-as-you-go | monthly |
| reddit-ads | pay-as-you-go | monthly |
| bing-ads | pay-as-you-go | monthly |
| quora-ads | pay-as-you-go | monthly |
| newsletter-sponsorship | pay-as-you-go | monthly |
| podcast-sponsorship | pay-as-you-go | monthly |
| creator-sponsorship | pay-as-you-go | monthly |
| software-directory-listing | pay-as-you-go | monthly |

The `vercel` (AI Gateway) plan row is **retired** — chat-service dropped the gateway in v0.51.0 and the catalog no longer declares it. The seed never deletes, so production keeps the retired plan row and the four gateway-priced `deepseek-v4-*-tokens-*` rows dated 2025-01-01 as history: spend already declared under those names must keep reading back at the price it was written with. They are inert at read time — each of those names has a newer, vendor-priced `deepseek` row in force, and a name's provider is resolved from its newest in-force row.

## API

### Platform prices (consumer-facing)

Consumer endpoints for getting resolved platform prices. No auth required. These resolve the provider cost via the active platform cost config — consumers don't need to know about plans.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/platform-prices` | No | List current platform price for every cost name, each with `status` (`current` \| `retired`), `supersededBy`, `lastUsedOn`, `usageReadAt`, `bundle` |
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

### Vendor cost per price version (staff-only, service api key)

What one unit of each price version REALLY cost us from the vendor, before our markup (non-recoverable VAT included: DeepSeek = list x 1.06). It reveals our margin, so it lives only here: `x-api-key` required, no identity headers, never proxied by the public gateway, and no `/v1/*` response carries any of these fields.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/internal/vendor-costs` | Yes | Every price version (all names, plans, dates) with `billedPricePerUnitInUsdCents`, `vendorCostPerUnitInUsdCents`, `vendorCostKnown`, `vendorCostUnknownReason`, `markupMultiplier`, `effectiveFrom`, `createdAt`. `?names=a,b` narrows it |
| GET | `/internal/vendor-costs/:name?at=<ISO>` | Yes | The version `/v1/platform-prices/:name` served at instant `at` (default now), with its vendor cost |

A version's vendor cost is stated only when a vendor rate the seed records reproduces its billed price EXACTLY under the markup in force when it was written (1x/2x overwrite era, 2x, 4x, 5x, 6x, 5x). Otherwise it is `null` with a reason (`no-billable-price`, `no-vendor-rate-on-record`, `ambiguous-vendor-rate`) and never the billed price.

### Paid from: which of our accounts pays each provider (staff-only, service api key)

Read LIVE from Kevin's bank ledger (admin.kevinlourd.com `GET /api/v1/vendors`, Bearer `LEDGER_API_KEY` against base `LEDGER_API_URL`), for the staff Monitoring > Providers table. Nothing is stored or cached here. `x-api-key` required, no identity headers.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/internal/provider-payment-sources` | Yes | `{ ledgerGeneratedAt, providers: [{ provider, providerDomain, match: "matched" \| "unmatched", ledgerVendors: [{ key, name }], lastPaidOn, paidFrom: [{ accountId, label, institutionDomain, scope: "personal" \| "business", lastPaidOn }] }] }`. Ledger unconfigured / unreachable / refusing / unknown shape = **502** naming the cause, never an empty list |
| GET | `/internal/email-send-price` | Yes | Price of one cold email sent to a lead (staff display, never billed): NET email-infra spend since inception (paid minus refunded, gross served beside) (bank ledger, vendors declared in `src/lib/email-infra-vendors.ts`) / emails to leads since inception (instantly-service). `{ formula, asOf, refreshedAt, stale, lastRefresh, currentPriceUsdCents, currentGrossPriceUsdCents, currentMonthPriceUsdCents, totals: { spendUsd, paidUsd, refundedUsd, emailsToLeads }, firstPaymentOn, firstSendOn, vendors: [{ key, label, what, firstPaidOn, lastPaidOn, payments, refunds, paidUsd, refundedUsd, netUsd }], excludedVendors, monthly: [{ month, spendUsd, spendByVendorUsd, paidUsd, refundedUsd, emailsToLeads, monthPriceUsdCents, cumulativeSpendUsd, cumulativeEmailsToLeads, priceUsdCents, cumulativePaidUsd, grossPriceUsdCents }], daily: [{ day, spendUsd, emailsToLeads, cumulativeSpendUsd, cumulativeEmailsToLeads, priceUsdCents, cumulativePaidUsd, grossPriceUsdCents, monthToDateSpendUsd, monthToDateEmailsToLeads, monthPriceUsdCents }] }`. Served from the last succeeded daily refresh; **503** before the first one |
| POST | `/internal/email-send-price/refresh` | Yes | Recompute now (the daily in-process refresh runs on its own). `{ refreshId, asOf, days }`; **409** while one runs; **502** when the ledger or instantly-service cannot answer (nothing written, last series stays served) |
| GET | `/internal/subscription-costs` | Yes | Real cost per credit of each vendor subscription (staff display, never billed): NET paid to its bank-ledger vendor(s) since 2026-01-01 (paid minus refunded, gross beside) / credits consumed through our own account since 2026-01-01 (runs-service `GET /internal/stats/costs/consumption`). Subscriptions, ledger vendors and credit cost names declared in `src/lib/subscriptions.ts`. `{ formula, since, asOf, refreshedAt, stale, lastRefresh, subscriptions: [{ key, label, provider, ledgerMatched, ledgerNote, ledgerVendors: [{ key, firstPaidOn, lastPaidOn, payments, refunds, paidUsd, refundedUsd, netUsd }], firstPaymentOn, lastPaymentOn, paidUsd, refundedUsd, netUsd, creditDefinition, orgKeyUnitsCounted, orgKeyUnitsNote, credits, costPerCreditUsdCents, grossCostPerCreditUsdCents, costPerCreditNullReason, costItems: [{ costName, isCredit, excludedReason, quantityPlatformKey, quantityOrgKey, creditsCounted, unit, billedPricePerUnitInUsdCents, vendorCostPerUnitInUsdCents, catalogueNote }], monthly: [{ month, paidUsd, refundedUsd, netUsd, credits, monthCostPerCreditUsdCents, cumulativeNetUsd, cumulativeCredits, costPerCreditUsdCents, grossCostPerCreditUsdCents }], daily: [{ day, paidUsd, netUsd, credits, cumulativePaidUsd, cumulativeNetUsd, cumulativeCredits, costPerCreditUsdCents, grossCostPerCreditUsdCents }] }] }`. Money null = no ledger line (unknown, never $0); cost per credit null over zero credits. **503** before the first refresh |
| POST | `/internal/subscription-costs/refresh` | Yes | Recompute now (the daily in-process refresh runs on its own). `{ refreshId, asOf, days, subscriptions }`; **409** while one runs; **502** when the ledger or runs-service cannot answer (nothing written, last series stays served) |
| GET | `/internal/real-costs` | Yes | Real cost per unit and PROPOSED price of every cost item on a day (`?day=YYYY-MM-DD`, default latest; series from 2026-01-01). Display only. Rules declared in `src/lib/price-lists.ts` (served as `rules`): email infra = email send price split across the two names recorded per email; subscription credit = real cost per credit; declared pay-as-you-go vendor = catalogue vendor cost x (metered spend / vendor cost recorded), where metered spend = the ledger net paid, except Twilio (its usage records: calls, sms, mms, channels; read with the key-service platform key) and Google Cloud (Gemini API consumption from the ledger's billing-export split `GET /api/v1/vendor-payments/google-cloud`, recorded usage counted from the export's first day); pass-through (Stripe, media) x1; otherwise catalogue vendor cost, flagged. Proposed = real x2 (x1 pass-through); no real cost per credit keeps the current price. `split` (Twilio, Google Cloud) serves where the bank money went: only `metered` is loaded on units; Twilio `rental` (phone numbers), `other`, `unconsumed-balance` (refresh day only) and Google `other-services`, `tax` (declared not a real cost), `adjustments`, `prepaid` are served apart, flagged; `unexplained` = net paid - every part. `{ formula, rules, day, asOf, refreshedAt, stale, lastRefresh, payAsYouGo: [{ provider, ledgerVendors, paidUsdCents, refundedUsdCents, netPaidUsdCents, numeratorBasis, meteredUsdCents, vendorCostRecordedUsdCents, ratio, split: null | { parts: [{ part, usdCents, basis, loadedOnUnits, flag }], unexplained: { usdCents, basis, loadedOnUnits, flag } } }], items: [{ costName, provider, method, flag, realCostPerUnitUsdCents, ratio, catalogueVendorCostPerUnitUsdCents, cataloguePricePerUnitUsdCents, catalogueMarkupOnRealCost, multiplier, proposedPricePerUnitUsdCents, proposedBasis, proposedVsCataloguePct }] }`; **503** before the first refresh |
| GET | `/internal/real-costs/:costName` | Yes | One item's `daily` series of the fields above since 2026-01-01 |
| GET | `/internal/price-lists?source=catalogue\|proposed&date=YYYY-MM-DD` | Yes | A price list at a date: catalogue = version in force at the day's end; proposed = that day's computed list. `{ source, date, items: [{ costName, provider, pricePerUnitUsdCents, ... }] }`; **404** for a proposed date outside the series |
| GET | `/internal/price-comparison?list1=<source>:<date>&list2=<source>:<date>[&orgId=][&brandId=][&interval=day\|week\|month]` | Yes | Replays every unit the perimeter (fleet / org / org x brand) consumed since inception under both lists: `totals`, `buckets[]` (+ `cumulative`), `costItems[]`, and at fleet grain `byOrg[]` / `byBrand[]` ranked by difference. Figures: `amount1/2UsdCents, differenceUsdCents, differencePct, realCostUsdCents, margin1/2UsdCents, margin1/2Pct, billedUsdCents, netBilledUsdCents, billedPlatformKeyUsdCents, netBilledPlatformKeyUsdCents` |
| POST | `/internal/real-costs/refresh` | Yes | Recompute now (daily in-process refresh runs after the email send price and subscription costs), then bill the day's proposed list (`catalogueSync`). `{ refreshId, asOf, days, costItems, catalogueSync: { syncId, proposedListDay, versionsWritten, unchanged, kept, written } }`; **409** / **502** as above (also when Twilio, key-service or the Google Cloud split cannot answer); **500** when the gold refreshed but the catalogue sync refused (stale input, zero-price guard): the last good catalogue stays billed |
| GET | `/internal/catalogue-syncs` | Yes | The last 10 attempts to bill the proposed list, newest first: `{ syncs: [{ id, realCostRefreshId, proposedListDay, status, error, versionsWritten, kept, startedAt, finishedAt }] }` |

Matching: a ledger vendor key belongs to the catalogue provider whose name (`google-ads`), domain (`instantly.ai`) or domain label (`instantly`) it STARTS WITH word for word, or failing that CONTAINS as whole words (reseller line `paddle net serper` -> `serper-dev`); a prefix fit beats a contained one, then the longest name wins (`google ads` -> `google-ads`, not `google`); a tie attaches it to neither. No alias list: a provider nothing fits is `unmatched`.

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

Integration tests need a database of their own. Locally that is a dedicated
`costs_test` database (never the shared `test` one — sibling services' migration
entries make drizzle skip this repo's). In CI it is a `postgres:16` service
container created for the run and discarded with the job: no external service,
no credentials, nothing shared between runs.

CI builds that database by replaying the migration journal (`npm run db:migrate`)
from empty, then fails the job if `drizzle-kit push` still wants to change
anything — that means `schema.ts` was edited without generating the matching
migration, which in production is a column the boot migrator never creates.
