# costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning and multi-plan support.

**Stack:** Express + Drizzle ORM + PostgreSQL

## Unit costs catalog

Every line states its **basis**, and there are only two:

- **`marked-up`** — work we perform (LLM tokens, embeddings, enrichment, search, creative generation). Price = the vendor rate × `COST_RISK_MULTIPLIER = 2` × `COST_PROFIT_MULTIPLIER = 3` = **6×** (risk covers cost under-estimation; profit is the store margin).
  The "vendor rate" is what the invoice says, which is not always what the price list says: DeepSeek adds 6% Chinese VAT on top of every top-up, and that VAT cannot be reclaimed through an EU VAT return, so it is part of the cost rather than a tax we advance. `withChinaVat` raises the published cell before the markup is taken. It is applied to DeepSeek only — Z.ai and Moonshot invoices carry no VAT line, and the test for adding it is an invoice, not the vendor's nationality.
- **`pass-through`** — money we merely route: advertising-platform spend and payment-processing fees. Price **is** the vendor rate. A customer who brings their own creatives pays exactly what the underlying platform charges and nothing more.

The basis is on the row and on every public price read (`GET /v1/platform-prices`, `GET /v1/platform-prices/:name`), so a caller — the public pricing page included — can tell the two apart without keeping its own list of names. The column is `NOT NULL` and the write paths require it: a line whose class cannot be resolved fails loudly rather than defaulting to either side.

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
| `apollo-credit` | 14.16 | credit | Credit | apollo | apollo.io | basic | monthly | marked-up |
| `apify-ahrefs-result` | 3 | result | Ahrefs scrape result | apify | apify.com | starter | monthly | marked-up |
| `apify-pipelinelabs-lead` | 0.6 | lead | PipelineLabs lead | apify | apify.com | starter | monthly | marked-up |
| `apify-microworlds-lead` | 0.96 | lead | MicroWorlds lead | apify | apify.com | starter | monthly | marked-up |
| `apify-clearpath-lead` | 9 | lead | ClearPath lead | apify | apify.com | starter | monthly | marked-up |
| `apify-pipelinelabs-actor-start` | 0.006 | run | PipelineLabs actor start | apify | apify.com | starter | monthly | marked-up |
| `apify-bounceverify-email` | 0.534 | email | BounceVerify email | apify | apify.com | starter | monthly | marked-up |
| `anthropic-opus-4.5-tokens-input` | 0.003 | 1M tokens | Input tokens (Opus 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-4.5-tokens-output` | 0.015 | 1M tokens | Output tokens (Opus 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-4.5-tokens-input` | 0.0018 | 1M tokens | Input tokens (Sonnet 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-4.5-tokens-output` | 0.009 | 1M tokens | Output tokens (Sonnet 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-4.6-tokens-input` | 0.0018 | 1M tokens | Input tokens (Sonnet 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-sonnet-4.6-tokens-output` | 0.009 | 1M tokens | Output tokens (Sonnet 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-4.6-tokens-input` | 0.003 | 1M tokens | Input tokens (Opus 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-opus-4.6-tokens-output` | 0.015 | 1M tokens | Output tokens (Opus 4.6) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-4.5-tokens-input` | 0.0006 | 1M tokens | Input tokens (Haiku 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-haiku-4.5-tokens-output` | 0.003 | 1M tokens | Output tokens (Haiku 4.5) | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `anthropic-web-search` | 6 | search | Web search | anthropic | anthropic.com | pay-as-you-go | monthly | marked-up |
| `featured-api-pitch-submit` | 0.3 | call | API call (pitch submit) | featured | featured.com | pay-as-you-go | monthly | marked-up |
| `postmark-email-send` | 0.9 | email | Email send | postmark | postmarkapp.com | basic-10k | monthly | marked-up |
| `postmark-email-send` | 0.99 | email | Email send | postmark | postmarkapp.com | pro-10k | monthly | marked-up |
| `postmark-email-send` | 1.08 | email | Email send | postmark | postmarkapp.com | platform-10k | monthly | marked-up |
| `firecrawl-scrape-credit` | 3.7999999998 | credit | Scrape credit | firecrawl | firecrawl.dev | hobby | monthly | marked-up |
| `firecrawl-map-credit` | 3.7999999998 | credit | Map credit | firecrawl | firecrawl.dev | hobby | monthly | marked-up |
| `firecrawl-extract-token` | 0.2533333332 | token | Extract token | firecrawl | firecrawl.dev | hobby | monthly | marked-up |
| `google-flash-3-tokens-input` | 0.0003 | 1M tokens | Input tokens (Gemini 3 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3-tokens-output` | 0.0018 | 1M tokens | Output tokens (Gemini 3 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.5-tokens-input` | 0.0009 | 1M tokens | Input tokens (Gemini 3.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.5-tokens-output` | 0.0054 | 1M tokens | Output tokens (Gemini 3.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.6-tokens-input` | 0.0009 | 1M tokens | Input tokens (Gemini 3.6 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.6-tokens-output` | 0.0045 | 1M tokens | Output tokens (Gemini 3.6 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.7-tokens-input` | 0.0009 | 1M tokens | Input tokens (Gemini 3.7 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-3.7-tokens-output` | 0.0045 | 1M tokens | Output tokens (Gemini 3.7 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.5-tokens-input` | 0.00018 | 1M tokens | Input tokens (Gemini 3.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.5-tokens-output` | 0.0015 | 1M tokens | Output tokens (Gemini 3.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-image-3.1-tokens-input` | 0.0003 | 1M tokens | Input tokens (Gemini 3.1 Flash Image) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-image-3.1-tokens-output` | 0.036 | 1M tokens | Image output tokens (Gemini 3.1 Flash Image) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-2.5-tokens-input` | 0.00018 | 1M tokens | Input tokens (Gemini 2.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-2.5-tokens-output` | 0.0015 | 1M tokens | Output tokens (Gemini 2.5 Flash) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-2.5-tokens-input` | 0.00006 | 1M tokens | Input tokens (Gemini 2.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-2.5-tokens-output` | 0.00024 | 1M tokens | Output tokens (Gemini 2.5 Flash-Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.1-tokens-input` | 0.00015 | 1M tokens | Input tokens (Gemini 3.1 Flash Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-flash-lite-3.1-tokens-output` | 0.0009 | 1M tokens | Output tokens (Gemini 3.1 Flash Lite) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-2.5-tokens-input` | 0.00075 | 1M tokens | Input tokens (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-2.5-tokens-output` | 0.006 | 1M tokens | Output tokens (Gemini 2.5 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-3.1-tokens-input` | 0.0012 | 1M tokens | Input tokens (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-pro-3.1-tokens-output` | 0.0072 | 1M tokens | Output tokens (Gemini 3.1 Pro) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-embedding-001-tokens-input` | 0.00009 | 1M tokens | Input tokens (Gemini Embedding 001) | google | google.com | pay-as-you-go | monthly | marked-up |
| `google-search-query` | 8.4 | query | Search query (grounding) | google | google.com | pay-as-you-go | monthly | marked-up |
| `scrape-do-credit` | 0.0696 | credit | Scrape credit | scrape-do | scrape.do | hobby | monthly | marked-up |
| `serper-dev-query` | 0.6 | query | Search query | serper-dev | serper.dev | pay-as-you-go | monthly | marked-up |
| `stripe-processing-fee` | 1 | USD cent | Charge processing fee | stripe | stripe.com | pay-as-you-go | monthly | pass-through |
| `stripe-refund-fee` | 1 | USD cent | Refund fee | stripe | stripe.com | pay-as-you-go | monthly | pass-through |
| `stripe-dispute-fee` | 1 | USD cent | Dispute fee | stripe | stripe.com | pay-as-you-go | monthly | pass-through |
| `stripe-payout-failure-fee` | 1 | USD cent | Payout failure fee | stripe | stripe.com | pay-as-you-go | monthly | pass-through |
| `twilio-sms-segment` | 7.98 | segment | SMS message | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `twilio-whatsapp-message` | 3 | message | WhatsApp message | twilio | twilio.com | pay-as-you-go | monthly | marked-up |
| `cloudflare-r2-class-a-operation` | 0.0027 | operation | R2 Class A operation | cloudflare | cloudflare.com | pay-as-you-go | monthly | marked-up |
| `cloudflare-r2-class-b-operation` | 0.000216 | operation | R2 Class B operation | cloudflare | cloudflare.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-tokens-input` | 0.000084 | 1M tokens | Input tokens (DeepSeek V4 Flash) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-tokens-output` | 0.000168 | 1M tokens | Output tokens (DeepSeek V4 Flash) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-tokens-input` | 0.000261 | 1M tokens | Input tokens (DeepSeek V4 Pro) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-tokens-output` | 0.000522 | 1M tokens | Output tokens (DeepSeek V4 Pro) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-input` | 0.00008904 | 1M tokens | Input tokens (DeepSeek V4 Flash, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-input` | 0.00027984 | 1M tokens | Input tokens (DeepSeek V4 Flash, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-cached-input` | 0.0000017808 | 1M tokens | Cached input tokens (DeepSeek V4 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-cached-input` | 0.000008904 | 1M tokens | Cached input tokens (DeepSeek V4 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-output` | 0.00017808 | 1M tokens | Output tokens (DeepSeek V4 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-peak-tokens-output` | 0.00083952 | 1M tokens | Output tokens (DeepSeek V4 Flash, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-input` | 0.00008904 | 1M tokens | Input tokens (DeepSeek V4 Flash, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-input` | 0.00013992 | 1M tokens | Input tokens (DeepSeek V4 Flash, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-cached-input` | 0.0000017808 | 1M tokens | Cached input tokens (DeepSeek V4 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-cached-input` | 0.000004452 | 1M tokens | Cached input tokens (DeepSeek V4 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-output` | 0.00017808 | 1M tokens | Output tokens (DeepSeek V4 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-flash-off-peak-tokens-output` | 0.00041976 | 1M tokens | Output tokens (DeepSeek V4 Flash, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-input` | 0.00027666 | 1M tokens | Input tokens (DeepSeek V4 Pro, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-input` | 0.00083952 | 1M tokens | Input tokens (DeepSeek V4 Pro, cache miss, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-cached-input` | 0.0000023058 | 1M tokens | Cached input tokens (DeepSeek V4 Pro, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-cached-input` | 0.000027984 | 1M tokens | Cached input tokens (DeepSeek V4 Pro, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-output` | 0.00055332 | 1M tokens | Output tokens (DeepSeek V4 Pro, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-peak-tokens-output` | 0.00251856 | 1M tokens | Output tokens (DeepSeek V4 Pro, peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-input` | 0.00027666 | 1M tokens | Input tokens (DeepSeek V4 Pro, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-input` | 0.00041976 | 1M tokens | Input tokens (DeepSeek V4 Pro, cache miss, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-cached-input` | 0.0000023058 | 1M tokens | Cached input tokens (DeepSeek V4 Pro, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-cached-input` | 0.000013992 | 1M tokens | Cached input tokens (DeepSeek V4 Pro, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-output` | 0.00055332 | 1M tokens | Output tokens (DeepSeek V4 Pro, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `deepseek-v4-pro-off-peak-tokens-output` | 0.00125928 | 1M tokens | Output tokens (DeepSeek V4 Pro, off-peak) | deepseek | deepseek.com | pay-as-you-go | monthly | marked-up |
| `zai-glm-4.7-flashx-tokens-input` | 0.000042 | 1M tokens | Input tokens (GLM-4.7-FlashX) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-4.7-flashx-tokens-cached-input` | 0.000006 | 1M tokens | Cached input tokens (GLM-4.7-FlashX) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-4.7-flashx-tokens-output` | 0.00024 | 1M tokens | Output tokens (GLM-4.7-FlashX) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.2-tokens-input` | 0.00084 | 1M tokens | Input tokens (GLM-5.2) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.2-tokens-cached-input` | 0.000156 | 1M tokens | Cached input tokens (GLM-5.2) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.2-tokens-output` | 0.00264 | 1M tokens | Output tokens (GLM-5.2) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-tokens-input` | 0.00084 | 1M tokens | Input tokens (GLM-5.3) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-tokens-cached-input` | 0.000156 | 1M tokens | Cached input tokens (GLM-5.3) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-tokens-output` | 0.00264 | 1M tokens | Output tokens (GLM-5.3) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-flash-tokens-input` | 0.00009 | 1M tokens | Input tokens (GLM-5.3-Flash) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-flash-tokens-cached-input` | 0.000018 | 1M tokens | Cached input tokens (GLM-5.3-Flash) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `zai-glm-5.3-flash-tokens-output` | 0.0003 | 1M tokens | Output tokens (GLM-5.3-Flash) | zai | z.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k2.6-tokens-input` | 0.00057 | 1M tokens | Input tokens (Kimi K2.6) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k2.6-tokens-cached-input` | 0.000096 | 1M tokens | Cached input tokens (Kimi K2.6) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k2.6-tokens-output` | 0.0024 | 1M tokens | Output tokens (Kimi K2.6) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k3-tokens-input` | 0.0018 | 1M tokens | Input tokens (Kimi K3) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k3-tokens-cached-input` | 0.00018 | 1M tokens | Cached input tokens (Kimi K3) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
| `moonshot-kimi-k3-tokens-output` | 0.009 | 1M tokens | Output tokens (Kimi K3) | moonshot | moonshot.ai | pay-as-you-go | monthly | marked-up |
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

## Platform costs

Each provider has an active platform cost config that determines which cost tier is used for billing. The `GET /v1/platform-prices/:name` endpoint resolves prices via the active platform cost — no fallbacks.

| Provider | Current Plan | Billing |
|---|---|---|
| apollo | basic | monthly |
| apify | starter | monthly |
| anthropic | pay-as-you-go | monthly |
| cloudflare | pay-as-you-go | monthly |
| deepseek | pay-as-you-go | monthly |
| featured | pay-as-you-go | monthly |
| firecrawl | hobby | monthly |
| google | pay-as-you-go | monthly |
| instantly | hypergrowth | monthly |
| moonshot | pay-as-you-go | monthly |
| postmark | pro-10k | monthly |
| scrape-do | hobby | monthly |
| serper-dev | pay-as-you-go | monthly |
| stripe | pay-as-you-go | monthly |
| twilio | pay-as-you-go | monthly |
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

Integration tests need a database of their own. Locally that is a dedicated
`costs_test` database (never the shared `test` one — sibling services' migration
entries make drizzle skip this repo's). In CI it is a `postgres:16` service
container created for the run and discarded with the job: no external service,
no credentials, nothing shared between runs.

CI builds that database by replaying the migration journal (`npm run db:migrate`)
from empty, then fails the job if `drizzle-kit push` still wants to change
anything — that means `schema.ts` was edited without generating the matching
migration, which in production is a column the boot migrator never creates.
