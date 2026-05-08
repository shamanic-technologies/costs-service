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

## Migration safety

The seed runs `INSERT ... ON CONFLICT DO UPDATE` only — it never DELETEs. As a result, **rows whose name is removed from the seed catalog persist forever as orphans** (apollo split, scrape-do split, instantly split, gemini→google rename, anthropic-opus naming all left orphans).

When writing a migration that adds a NOT NULL constraint, a CHECK constraint, or any other invariant to an existing column, you MUST account for orphan rows that pre-date the rename. Either:

1. Backfill the orphan rows explicitly, OR
2. Delete them in the migration before locking the constraint, e.g.
   `DELETE FROM providers_costs WHERE <column> IS NULL;`

A regression for this exact failure mode shipped in v0.16.1 (PR #99) — see `tests/integration/migration_0004_orphans.test.ts`.
