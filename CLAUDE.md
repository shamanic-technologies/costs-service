# Project: costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning.

## Release flow (NO `release.sh` here — staging-first, then promote)

This repo does **not** use the `release.sh` hotfix flow. Every code/seed change ships through staging:

1. Branch from `origin/staging`, open PR with **base `staging`**, merge via `gh pr merge --auto --squash`.
2. Promotion to `main`/prod is a **separate** PR titled `chore: promote staging to vX.Y.Z` (base `main`), then tag `vX.Y.Z` + `gh release create` on the merge commit (minor bump from the latest tag).

**The branch-guard hook BLOCKS `gh pr create --base main` — create the promote PR via `gh api` instead** (the guard substring-matches `gh pr ... --base main`, not the REST endpoint, same path `release.sh` uses): `gh api repos/shamanic-technologies/costs-service/pulls -X POST -f title="chore: promote staging to vX.Y.Z" -f head=staging -f base=main -f body="..."`. Then `gh pr merge <N> --auto --squash`. After merge: `gh release create vX.Y.Z --target <full-40char-merge-sha> --title vX.Y.Z --notes "..."` (abbreviated SHA → `Release.target_commitish is invalid`). Verify prod deploy: `gh api "repos/shamanic-technologies/costs-service/deployments?sha=<sha>" -q '.[0].id'` then `.../deployments/<id>/statuses` → `state:success`.

**Verify the working branch's base BEFORE committing — a Conductor workspace may pre-create the branch off `main`, not `staging`.** `main` carries promote merges absent from `staging`, so a branch sitting on `main` opens a PR whose diff includes unrelated promote commits. Check `git log origin/staging..HEAD --oneline` (must be empty before your work); if it shows main-only commits, repoint: `git stash && git checkout -B <branch> origin/staging && git stash pop`. (`git reset --hard` is hook-blocked here — use `checkout -B`.)

Do NOT open seed/cost PRs directly against `main` — every recent seed PR (#127/#129/#131) targeted `staging`; the matching `main` merges (#128/#130/#132) are promote PRs only. A **price change to an existing cost is a billing change (not zero-blast-radius)** → always staging-first, never prod-direct, regardless of how small the diff looks.

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

**Running `test:integration` locally — use a DEDICATED `costs_test` DB, not the shared `test` DB.** `tests/setup.ts` defaults `COSTS_SERVICE_DATABASE_URL` to `postgresql://test:test@localhost/test`. That shared DB is used by sibling services, so its `drizzle.__drizzle_migrations` table already carries their entries with later `when` timestamps — the drizzle migrator then SKIPS costs-service's migrations (content-agnostic ordering), and every integration test fails with `relation "providers_costs" does not exist`. Fix: `createdb costs_test` (owner `test`), then `COSTS_SERVICE_DATABASE_URL="postgresql://test:test@localhost/costs_test" npm run db:migrate` once, then run `COSTS_SERVICE_DATABASE_URL="postgresql://test:test@localhost/costs_test" npm run test:integration`. Unit tests + `build` + `check:readme` need no DB.

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

## Changing a price = append-only history (NEVER overwrite)

The cost catalog is **time-versioned**: `providers_costs` keys on `(name, plan_tier, billing_cycle, effective_from)` and the read path resolves the newest row whose `effective_from <= now()` (`platform-prices.ts`, `getCurrentPlatformCost`). So full price history is queryable — "the price before date X" = the row with `max(effective_from) <= X`.

**To change a price, just edit the value in `src/db/seed.ts` — do NOT touch `effectiveFrom`.** `seedProvidersCosts` / `seedPlatformCosts` compare each seed row's value to the **latest** existing row for its key and:
- no row yet → INSERT with the declared `effectiveFrom` (first version)
- value differs → INSERT a **new row dated `now()`** (the prior row stays as history)
- value equal → no-op (idempotent across every boot)

The boundary between the old and new price is the **deploy timestamp** (`now()`), not a hand-set date.

**Store markup = `COST_RISK_MULTIPLIER` × `COST_PROFIT_MULTIPLIER` (two factors, default 2 × 2 = 4×).** Every seed value is `raw × COST_DEFAULT_MULTIPLIER` where `COST_DEFAULT_MULTIPLIER = COST_RISK_MULTIPLIER * COST_PROFIT_MULTIPLIER` (`src/db/seed.ts`). Risk covers cost under-estimation; profit is the store margin. `applyCostRiskMultiplier(raw)` applies the product; an explicit 2nd-arg override REPLACES the whole markup (profit does NOT stack on an override — the override path is test-only today). Changing either factor reprices EVERY cost at once via the append-only path above (new `now()`-dated rows on deploy). When you touch a factor you must also: double/halve the README catalog values (`npm run check:readme`), the seed-derived test literals (`tests/unit/providers-costs.test.ts` + per-provider `*-costs.test.ts` + `tests/integration/{stripe-fees,seed-append-history}.test.ts`), leaving fixture-inserted integration literals (`insertTestProviderCost`) untouched.

**NEVER reintroduce `ON CONFLICT (...) DO UPDATE SET cost_per_unit_in_usd_cents` (or `plan_tier`).** Reusing an `effective_from` + DO UPDATE silently OVERWRITES the row and destroys history — that was the bug. Past reprices (featured pitch #134, google rename, etc.) already lost their history this way; the fix only protects future changes. A `pg_advisory_xact_lock` serializes concurrent boots so multi-replica deploys can't double-append. Regression: `tests/integration/seed-append-history.test.ts` (fails red under DO UPDATE — one row, old value gone).

## Instantly cost model (prewarmed-inbox infra, 2026-07)

Instantly cold-email spend is seeded as **3 cost names**, all `provider: "instantly"`. The
SERVED tier is **`hypergrowth` / `monthly`** (`SEED_PLATFORM_COSTS`); the `growth` rows are
inert history (never resolved by `platform-prices`) kept only so both tiers stay coherent.
The email infra is **plan-agnostic**, so `growth` and `hypergrowth` carry identical email values.

**Infra assumptions** (replaced the older Mailforge model — domain $26/yr shared by 2 accounts,
$3/mo/account, 20 sends/business-day):

| input | value |
|-------|-------|
| domain purchase | $15/yr |
| accounts per domain | 5 (prewarmed) |
| account hosting | **$10/mo per account** = $120/yr |
| max sends | 30 emails/business-day/account |
| business days | 252/yr → **7,560 sends/yr/account**, **37,800/yr/domain** (×5) |
| contact upload | $97/mo Hypergrowth sub → 25,000 contacts |
| deliverability tool | $47/mo **global** (one subscription for the whole fleet) = $564/yr |
| fleet size (deliverability denominator) | 30 domains × 5 = 150 accounts × 7,560 = **1,134,000 sends/yr** |

**Per-cost derivation** (base ¢/email, before the ×2 `applyCostRiskMultiplier` store markup):

- `instantly-account-email-sent` = hosting **+ folded deliverability** (option B — no separate
  cost name, so instantly-service declares no new cost):
  - hosting = $120/yr ÷ 7,560 = **1.5873015873¢**
  - deliverability = $564/yr ÷ 1,134,000 = **0.0497354497¢**
  - account row = **1.6370370370¢** (stored ×2 = 3.2740740740)
- `instantly-domain-email-sent` = $15/yr ÷ 37,800 = **0.0396825397¢** (stored ×2 = 0.0793650794)
- account + domain = **1.6767195767¢/email** total (stored ×2 = 3.3534391534)
- `instantly-contact-uploaded` = $97/mo ÷ 25,000 = **0.388¢/contact** (unchanged; stored ×2 = 0.776)

**Why deliverability is folded into the account row (option B, not a 4th cost name):** a new
cost name would be inert until instantly-service declares it per send (extra consumer PR). Folding
keeps the SUM correct with zero consumer change. The account row is the right home because
deliverability testing is per-inbox health. If you ever need it broken out for reporting, split it
into `instantly-deliverability-test-email-sent` AND add the declaration in instantly-service — do
not leave a dangling cost name.

Regression: `tests/unit/instantly-email-costs.test.ts` asserts each base value, that account+domain
sum to the full per-email cost, and that the served row matches the active platform cost's
`(planTier, billingCycle)`. Reprice = edit the value in `src/db/seed.ts` per the append-only rule
below; update the same literals in `tests/unit/providers-costs.test.ts`,
`tests/integration/seed-append-history.test.ts`, and the README table.

## Migration safety

The seed runs append-only `INSERT ... SELECT` (compare-to-latest, no `ON CONFLICT DO UPDATE`) — it never DELETEs. As a result, **rows whose name is removed from the seed catalog persist forever as orphans** (apollo split, scrape-do split, instantly split, gemini→google rename, anthropic-opus naming all left orphans).

When writing a migration that adds a NOT NULL constraint, a CHECK constraint, or any other invariant to an existing column, you MUST account for orphan rows that pre-date the rename. Either:

1. Backfill the orphan rows explicitly, OR
2. Delete them in the migration before locking the constraint, e.g.
   `DELETE FROM providers_costs WHERE <column> IS NULL;`

A regression for this exact failure mode shipped in v0.16.1 (PR #99) — see `tests/integration/migration_0004_orphans.test.ts`.

## DB connection lifecycle

The seed bypasses the Neon pooler (uses the direct compute endpoint via `directConnectionString` in `src/db/index.ts`) because pgbouncer transaction mode can silently drop multi-statement writes. **Direct (non-pooler) postgres clients used only at startup MUST be opened and closed inside the function that uses them** — never as module-level singletons. A module-level direct client occupies a Neon compute connection slot for the lifetime of every Cloud Run instance, exhausts Neon's permit cap under autoscale, and surfaces as `PostgresError XX000 Failed to acquire permit` + `CONNECT_TIMEOUT undefined:undefined`. Pattern: `const c = postgres(directConnectionString, ...); try { ... } finally { await c.end({ timeout: 5 }); }`.

A regression for this failure mode shipped in v0.16.6 — see `tests/unit/db-pool-config.test.ts` and `tests/integration/seed-no-leak.test.ts`.

The pooled `sql` client in `src/db/index.ts` MUST keep explicit `max`, `idle_timeout`, `connect_timeout` — defaults (`max=10`, `idle_timeout=null`) stack idle connections and pile acquire attempts on a saturated pool.
