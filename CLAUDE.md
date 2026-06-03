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
- `src/routes/costs.ts` — CRUD endpoints for unit costs (`/v1/costs`)
- `src/routes/health.ts` — Health check endpoint
- `src/middleware/auth.ts` — API key authentication middleware
- `src/db/index.ts` — Drizzle ORM database connection
- `src/db/schema.ts` — Drizzle table definitions
- `src/db/seed.ts` — Seed data with all unit costs (must stay in sync with README)
- `tests/unit/` — Unit tests
- `tests/integration/` — Integration tests
- `openapi.json` — Auto-generated from Zod schemas, do NOT edit manually

## Seeding a cost for a NEW provider

`GET /v1/platform-prices/:name` resolves a price by joining `providers_costs` to the **active `platform_costs` row for that provider**, matching on `(planTier, billingCycle)` — no fallback (`src/routes/platform-prices.ts`). A cost row alone is NOT enough:

- If the provider has **no** `SEED_PLATFORM_COSTS` entry → the endpoint returns **500** `No platform cost configured for provider '<x>'`.
- If the platform-cost tier ≠ the provider-cost tier → **404** `No price found ... on plan '<tier>'`.

So when a seed addition introduces a provider not already in `SEED_PLATFORM_COSTS`, you MUST add **both**: the `SEED_PROVIDERS_COSTS` row AND a `SEED_PLATFORM_COSTS` row with byte-equal `planTier` + `billingCycle`. Mirror the per-cost unit test in `tests/unit/<provider>-*.test.ts` — assert the provider row's `(planTier, billingCycle)` equals the active platform cost's (the guard that fails red when the platform row is missing; see `apify-ahrefs-costs.test.ts`, `google-embedding-costs.test.ts`). Also add the provider to the README "Platform costs" table.

## Migration safety

The seed runs `INSERT ... ON CONFLICT DO UPDATE` only — it never DELETEs. As a result, **rows whose name is removed from the seed catalog persist forever as orphans** (apollo split, scrape-do split, instantly split, gemini→google rename, anthropic-opus naming all left orphans).

When writing a migration that adds a NOT NULL constraint, a CHECK constraint, or any other invariant to an existing column, you MUST account for orphan rows that pre-date the rename. Either:

1. Backfill the orphan rows explicitly, OR
2. Delete them in the migration before locking the constraint, e.g.
   `DELETE FROM providers_costs WHERE <column> IS NULL;`

A regression for this exact failure mode shipped in v0.16.1 (PR #99) — see `tests/integration/migration_0004_orphans.test.ts`.

## DB connection lifecycle

The seed bypasses the Neon pooler (uses the direct compute endpoint via `directConnectionString` in `src/db/index.ts`) because pgbouncer transaction mode can silently drop multi-statement writes. **Direct (non-pooler) postgres clients used only at startup MUST be opened and closed inside the function that uses them** — never as module-level singletons. A module-level direct client occupies a Neon compute connection slot for the lifetime of every Cloud Run instance, exhausts Neon's permit cap under autoscale, and surfaces as `PostgresError XX000 Failed to acquire permit` + `CONNECT_TIMEOUT undefined:undefined`. Pattern: `const c = postgres(directConnectionString, ...); try { ... } finally { await c.end({ timeout: 5 }); }`.

A regression for this failure mode shipped in v0.16.6 — see `tests/unit/db-pool-config.test.ts` and `tests/integration/seed-no-leak.test.ts`.

The pooled `sql` client in `src/db/index.ts` MUST keep explicit `max`, `idle_timeout`, `connect_timeout` — defaults (`max=10`, `idle_timeout=null`) stack idle connections and pile acquire attempts on a saturated pool.
