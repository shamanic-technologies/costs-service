# Project: costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning.

## Commands

- `npm test` — run all tests (Vitest)
- `npm run test:unit` — unit tests only
- `npm run test:integration` — integration tests only
- `npm run build` — compile TypeScript + generate OpenAPI spec
- `npm run dev` — local dev server (tsx watch, port 3011)
- `npm run generate:openapi` — regenerate `openapi.json` from Zod schemas
- `npm run db:migrate` — run Drizzle migrations
- `npm run db:push` — push schema to database
- `npm run db:seed` — seed unit costs from `src/db/seed.ts`
- `npm run db:studio` — open Drizzle Studio
- `npm run check:readme` — verify README costs table matches seed data

## Architecture

- `src/index.ts` — Express app entry point
- `src/schemas.ts` — Zod schemas (source of truth for validation + OpenAPI)
- `src/routes/providers-costs.ts` — CRUD on `providers_costs` (per-plan price points)
- `src/routes/platform-prices.ts` — Public-facing prices resolved via the active platform plan (consumer-facing endpoints used by `landing.distribute.you`)
- `src/routes/platform-costs.ts` — Per-provider active platform plan config
- `src/routes/health.ts` — Health check endpoint
- `src/middleware/auth.ts` — API key authentication middleware
- `src/db/index.ts` — Drizzle ORM database connection
- `src/db/schema.ts` — Drizzle table definitions (`providers_costs`, `platform_costs`)
- `src/db/seed.ts` — Seed data with all unit costs (must stay in sync with README)
- `tests/unit/` — Unit tests
- `tests/integration/` — Integration tests
- `openapi.json` — Auto-generated from Zod schemas, do NOT edit manually

## `type` vs `unit` on `providers_costs` rows

`type` is the public-facing label rendered on the pricing page (e.g. `"Input tokens (Sonnet 4.6)"`, `"SMS message"`). `unit` is the technical billing chunk (e.g. `"1M tokens"`, `"segment"`, `"credit"`).

Keep `type` user-readable. Do not push the technical billing chunk into `type` — e.g. Twilio bills per "segment" (a 160-char/70-char SMS chunk), but `type` should be `"SMS message"`, not `"SMS segment"`. The segment distinction belongs in `unit` (and the README footnote), not in `type`.
