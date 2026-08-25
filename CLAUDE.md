# Project: costs-service

Microservice for managing unit costs. Tracks per-unit pricing for external APIs and services with time-based versioning.

## Release flow (NO `release.sh` here — staging-first, then promote)

This repo does **not** use the `release.sh` hotfix flow. Every code/seed change ships through staging:

1. Branch from `origin/staging`, open PR with **base `staging`**, merge via `gh pr merge --auto --squash`.
2. Promotion to `main`/prod is a **separate** PR titled `chore: promote staging to vX.Y.Z` (base `main`), then tag `vX.Y.Z` + `gh release create` on the merge commit (minor bump from the latest tag).

**The branch-guard hook BLOCKS `gh pr create --base main` — create the promote PR via `gh api` instead** (the guard substring-matches `gh pr ... --base main`, not the REST endpoint, same path `release.sh` uses): `gh api repos/shamanic-technologies/costs-service/pulls -X POST -f title="chore: promote staging to vX.Y.Z" -f head=staging -f base=main -f body="..."`. Then `gh pr merge <N> --auto --squash`. After merge: `gh release create vX.Y.Z --target <full-40char-merge-sha> --title vX.Y.Z --notes "..."` (abbreviated SHA → `Release.target_commitish is invalid`). **Prod deploy is the Hetzner box, NOT a GitHub deployment** — `gh api ".../deployments?sha=<sha>"` returns EMPTY here (that check is a leftover from the Railway era; an empty result is not a failed deploy). The box's `*/5 * * * * /root/distribute/deploy-cron.sh` fetches and rebuilds, so verify by polling the box clone for the promote commit SUBJECT (a squash changes the sha):
```bash
ssh -i ~/.ssh/oracle-distribute root@167.233.196.79 \
  "cd /root/distribute/repos/costs-service && git log -1 --format='%h %s'; docker ps --format '{{.Status}}' -f name=distribute-costs-service-1"
```
Then confirm the seed actually ran and the row SERVES (state ≠ behaviour): read `providers_costs` via `docker exec distribute-postgres-1 psql -U postgres -d costs_service`, and exercise `GET /v1/platform-prices/<name>` **inside** the container — the container listens on `PORT=8080`, NOT the local-dev 3011, and no port is published to the host, so `fetch('http://localhost:3011/...')` fails with a bare `fetch failed`:
```bash
ssh -i ~/.ssh/oracle-distribute root@167.233.196.79 "K=\$(grep -E '^COSTS_SERVICE_API_KEY=' /root/distribute/env/costs-service.env | cut -d= -f2-); \
  docker exec distribute-costs-service-1 node -e \"…fetch('http://localhost:8080/v1/platform-prices/'+n,{headers:{'x-api-key':k,'x-service-name':'verify'}})…\" \"\$K\""
```

**The promote PR routinely opens `DIRTY` — that is EXPECTED, not a broken branch.** `staging` PRs are SQUASH-merged, so a feature's squash on `staging` and its promote-squash on `main` are two different commits carrying the same content → every later promote conflicts on the same lines. Resolve it locally and fast-forward `staging`; do NOT close the PR or rebuild the branch:
```bash
git checkout -B promote-resolve origin/staging && git merge origin/main --no-edit   # conflicts expected
git checkout --ours <conflicted files> && git add -A && git commit --no-edit         # staging content always wins
npm run check:readme && npm run test:unit && npm run build
git push origin HEAD:refs/heads/staging   # fast-forward, no --force
```
`--ours` is safe here only because `main` carries nothing but promote-squashes of commits `staging` already has — confirm with `git log origin/staging..origin/main --oneline` first, and after the push verify `git diff origin/main --stat` shows ONLY your intended files. The open promote PR then flips to `MERGEABLE` on its own.

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

**CI runs integration tests against a `postgres:16` service container created per run** (`.github/workflows/test.yml`) — it replaced the Neon branch the workflow used to cut, which stopped existing when the fleet moved to the self-hosted Postgres. The container starts EMPTY, so the schema is built by replaying the journal (`npm run db:migrate`), the same path `runMigrationsIfNeeded` takes on boot — the Neon branch was forked from prod and already had the tables, so the migration SQL was never exercised in CI at all. A final step fails the job if `drizzle-kit push` still reports changes: that means `schema.ts` drifted from what the migrations build, i.e. a column prod would never get. Both steps grep their own output — `drizzle-kit push` prints `error:` and still exits 0. Guard: `tests/unit/ci-workflow.test.ts`.

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

**A price change the vendor has ANNOUNCED but not yet started charging is a SECOND seed entry for the same name, dated at the moment it starts — not an edit.** `SEED_PROVIDERS_COSTS` allows several entries per cost name, one per version. `seedProvidersCosts` runs two statements: future-dated entries are inserted verbatim at their declared `effectiveFrom` (keyed on the exact `(name, plan_tier, billing_cycle, effective_from)`, so re-seeding is a no-op), and of the entries whose date has arrived the NEWEST one is compared to the newest row already in force. **Both "newest" lookups are bounded by `now()`** — drop that bound and the scheduled row reads as drift, so every boot appends a `now()`-dated row that cancels the announced change. Regression: `tests/integration/seed-scheduled-price.test.ts`. Use this instead of hand-timing a deploy to the minute a vendor's new rate starts.

**A priced dimension goes in the NAME; the rule for picking the name goes on the ROW.** Vendors price the same model along more than one dimension: token class (`-tokens-input` = cache miss, `-tokens-cached-input` = cache hit, `-tokens-output`) and, for DeepSeek from 2026-08-16T16:00Z, a pricing regime (`-peak-` / `-off-peak-` before `-tokens-…`). Each combination is its own cost name — never blend two rates into one price, and never let a consumer derive a rate. What the name alone cannot carry is WHEN a regime applies, so the row carries `pricingRegime` + `regimeHoursUtc` and both are on every `/v1/platform-prices` response. A window is `Days@HH:MM-HH:MM` (half-open on the minute, days as a `Mon`..`Sun` range), comma-separated. A provider's regimes must PARTITION the whole WEEK, so for one model and token class exactly one name matches any instant; a provider with no time-of-day pricing leaves both columns NULL. Adding a regime to a name that previously had none SUPERSEDES the regime-free name rather than repricing it — there is no honest value to append to a name whose rate stopped existing, so it is frozen and consumers must move.

**The regime is not always purely TIME of day — read the vendor's rule, not the shape of the column you already have.** DeepSeek's windows were weekday-agnostic until 2026-08-23, when it made weekends (Beijing time) off-peak all day. A `HH:MM-HH:MM` grammar cannot express that, and the failure is silent in the worst way: the catalog keeps answering 200 with a peak rate, and a consumer picking the name by clock overcharges the org 2× for every weekend peak hour while the vendor bills off-peak. Nothing compares the declared cost name to the vendor's invoice, so nothing detects it. Hence the day scope in the grammar. Two things to carry forward: (a) the Beijing weekend runs Fri 16:00Z–Sun 16:00Z, which only reduces to whole UTC Saturdays and Sundays because every peak window sits between 01:00 and 10:00 UTC — if a vendor moves a window past 16:00Z the reduction breaks and the grammar needs a real timezone, not a wider day range; (b) the windows are duplicated in chat-service (it holds its own copy rather than reading the catalog at runtime), so a window change is a two-repo change or the two start describing the vendor's rule differently.

**The seed's compare-to-latest spans `(cost, basis, regime_hours_utc)` — anything that determines what a caller is charged, not just the number.** The windows say WHEN a row's rate applies, so moving one reprices every instant that changed sides. They were missing from the tuple, which made a windows-only edit a SILENT NO-OP: the seed wrote nothing, production kept serving the old schedule, and the deploy log looked clean. If you add another column that changes what a caller pays, add it to that tuple in the same PR. Regression: `tests/integration/seed-append-history.test.ts` AC9 (fails red as one row with the old windows).

**Retiring a PROVIDER (a vendor path we stopped buying from) = STOP DECLARING it in the seed. Never delete, never re-point, never re-price.** Same call as the frozen superseded cost names above, one level up. Remove the provider's `SEED_PLATFORM_COSTS` entry and its `PROVIDER_DOMAINS` entry — there is no honest plan to name for a provider we no longer buy from. The seed never DELETEs, so production keeps the retired plan row and every cost row that carried the provider; that is the point, because the runs ledger froze those prices onto spend already declared and reading that spend back must keep resolving the row it was written with. The retired rows are inert only because each of their names has a newer, in-force row on the new provider. Verify that before retiring: a name whose ONLY row sits on the retired provider goes dark (`/v1/platform-prices/:name` 500s `No platform cost configured for provider '<x>'`). Precedent: `vercel` (AI Gateway), retired in v0.46.0 after chat-service v0.51.0 dropped the gateway path — regression `tests/integration/vercel-gateway-retirement.test.ts`.

**A cost name's PROVIDER is resolved from its NEWEST IN-FORCE row, never from an arbitrary one.** A name can carry rows from more than one provider once a vendor path is retired (the gateway left `vercel` rows under the `deepseek-v4-*` names). `/v1/platform-prices/:name` and `/v1/providers-costs/:name` both resolve the provider with `effective_from <= now()` ordered newest-first — the same row the price comes from. They used to use an unordered `limit(1)`, which could read a superseded provider and then resolve the price against a retired provider's plan, or 500 once that plan row was gone. Keep the two lookups in step.

**Every line declares a PRICING BASIS, and only money we ROUTE is priced at the vendor rate.** `providers_costs.pricing_basis` is `NOT NULL` and takes exactly two values. `marked-up` = work we PERFORM (LLM tokens, embeddings, enrichment, search, creative generation), priced `raw × COST_DEFAULT_MULTIPLIER` via `applyCostRiskMultiplier`. `pass-through` = money we merely ROUTE — advertising-platform spend and payment-processing fees — priced at the vendor rate via `passThroughVendorPrice`, which returns its input untouched and exists so a zero-markup row reads as a decision rather than a forgotten call. This is the commercial promise of the "one API to every acquisition channel" positioning ("no markup on what we route"), so it is not a private implementation detail: `pricingBasis` is on every `/v1/platform-prices` and `/v1/providers-costs` response and the public pricing page reads it per line. Do NOT add a consumer-side list of which names are which — the classification lives here.

No default anywhere on the write side: the field is required on `SeedProviderCost` (an untagged seed row does not compile), required by `PutProviderCostBodySchema` (an untagged PUT is a 400), and `NOT NULL` in the column. The read side refuses to guess too — `assertPricingBasis` in `platform-prices.ts` 500s on a value that is neither of the two rather than omitting the field. A routed line is priced at **1 cent per USD cent of vendor spend** (`unit: "USD cent"`), so the consumer reports `quantity` = the vendor amount in cents and the org is charged that amount exactly. Generating the creative FOR one of those campaigns stays a marked-up LLM/image line: buying the placement is routing, making the ad is work. Changing a line's basis is a price change like any other — the seed's compare-to-latest covers `(cost, basis)`, so dropping a markup appends a `now()`-dated row even where the number is unchanged. Regressions: `tests/unit/pricing-basis.test.ts`, `tests/integration/pricing-basis.test.ts`, `tests/integration/seed-append-history.test.ts` (AC1b). Advertising channels seeded 2026-08: Google/Meta/LinkedIn/TikTok/YouTube/X/Reddit/Bing/Quora Ads plus newsletter, podcast and creator sponsorships and paid software-directory listings — one provider each, so each also needs its `SEED_PLATFORM_COSTS` row.

**The seed's startup verify counts ROWS A FRESH SEED WRITES, not seed ENTRIES — `expectedSeedRowFloor()`, never `SEED_PROVIDERS_COSTS.length`.** A cost name carries one entry per price VERSION, and of the versions already in force only the NEWEST is written to an empty database; a version dated in the future is written as its own row. Counting entries therefore passes while a scheduled price is pending and starts failing the instant it comes into force — i.e. on the one day nothing is wrong. That fired on 2026-08-16T16:00Z when DeepSeek's peak/off-peak rates arrived, taking the startup verify and three integration tests red (fixed in the same PR as the pricing basis). Same trap in tests: assert against dates/values DERIVED from `SEED_PROVIDERS_COSTS`, never hardcoded schedule literals — `seed-scheduled-price.test.ts` hardcoded DeepSeek's two dates and could only ever be correct on one side of them.

**A vendor's LIST price is not always what we PAY — a non-recoverable tax on top of it belongs in the vendor basis, under the markup, never in the markup.** DeepSeek adds 6% Chinese VAT to every top-up ($5.00 is charged as $5.30). Chinese VAT cannot be reclaimed through an EU VAT return, so it is spend rather than an advance, which is exactly what makes it part of the cost of the call: `withChinaVat` raises the published cell and `applyCostRiskMultiplier` then takes the store margin on the VAT-inclusive figure. Order matters (marking up first would charge our own margin the vendor's tax) and the seed literals stay byte-equal to the vendor's published table, so the invoice-vs-list-price difference lives in one named function rather than in 18 edited numbers. **It is applied to DeepSeek ALONE, and that asymmetry is deliberate: Z.ai and Moonshot are also Chinese vendors and their invoices carry no VAT line.** The test is an invoice, never the vendor's nationality — do not "fix" the inconsistency by extending it, and do not add it to a new vendor until an invoice shows it. Regression: `tests/unit/deepseek-china-vat.test.ts`.

**Store markup = `COST_RISK_MULTIPLIER` × `COST_PROFIT_MULTIPLIER` (two factors, default 2 × 2.5 = 5×).** Every seed value is `raw × COST_DEFAULT_MULTIPLIER` where `COST_DEFAULT_MULTIPLIER = COST_RISK_MULTIPLIER * COST_PROFIT_MULTIPLIER` (`src/db/seed.ts`). Risk covers cost under-estimation; profit is the store margin. `applyCostRiskMultiplier(raw)` applies the product; an explicit 2nd-arg override REPLACES the whole markup (profit does NOT stack on an override — the override path is test-only today). Changing either factor reprices EVERY cost at once via the append-only path above (new `now()`-dated rows on deploy) — and only `marked-up` lines: `pass-through` never carries a markup, so a factor change must leave every routed line at exactly the vendor rate. Profit went 2 → 2.5 (4× → 5×) in 2026-08 when the cold-email infrastructure spend moved onto our own fixed costs: the markup on what we still rebill carries the unit economics the retired lines used to. When you touch a factor you must also: rescale the README catalog values (`npm run check:readme`), the seed-derived test literals (`tests/unit/providers-costs.test.ts` + per-provider `*-costs.test.ts` + `tests/integration/{stripe-fees,seed-append-history}.test.ts`), leaving fixture-inserted integration literals (`insertTestProviderCost`) untouched.

**NEVER reintroduce `ON CONFLICT (...) DO UPDATE SET cost_per_unit_in_usd_cents` (or `plan_tier`).** Reusing an `effective_from` + DO UPDATE silently OVERWRITES the row and destroys history — that was the bug. Past reprices (featured pitch #134, google rename, etc.) already lost their history this way; the fix only protects future changes. A `pg_advisory_xact_lock` serializes concurrent boots so multi-replica deploys can't double-append. Regression: `tests/integration/seed-append-history.test.ts` (fails red under DO UPDATE — one row, old value gone).

## Cold-email infrastructure = DELISTED, not deleted (2026-08)

Instantly subscriptions, MailForge, PrimeForge and the Claude Max seat moved OFF the
per-customer rebill and onto our own fixed costs, and instantly-service stopped declaring
per-email spend. So the three `provider: "instantly"` names — `instantly-account-email-sent`,
`instantly-domain-email-sent`, `instantly-contact-uploaded` — receive no new usage and must
stop being advertised as a current price. (MailForge/PrimeForge never had catalog lines of
their own; that infra was priced through the `instantly-*-email-sent` rows.)

**A line that stops being rebilled gets a NULL price, and that is the whole mechanism.**
`costPerUnitInUsdCents: noLongerBillable()` in the seed is a price VERSION like any other, so
the append-only path writes one `now()`-dated null row per (name, plan, cycle) and leaves every
priced row exactly as written. Read-side consequences, all already implemented:

- `GET /v1/platform-prices` and `GET /v1/providers-costs` DROP the name — and mark it `seen`
  BEFORE the null check, so an older priced version can never be served in its place (that
  would resurrect a price we stopped charging).
- `GET /v1/platform-prices/:name` still answers **200** with `pricePerUnitInUsdCents: null` and
  `billable: false`; `/v1/providers-costs/:name`, `/:name/history` and `/:name/plans` still
  resolve. runs-service holds historical cost rows under these names and a reconcile sweep
  still PATCHes old holds by cost id, so they must never 404 or 500.

**Three things that look like the fix and are not:**

1. **A zero price.** It asserts the line costs nothing, which is false — we still pay for the
   inboxes, we simply stopped passing it on. Absence of a billable price is the honest record.
2. **Deleting the name from the seed.** The seed never DELETEs, so the rows would survive as
   orphans, but the name would drift out of the catalog with nothing stating why.
3. **Retiring the `instantly` PROVIDER** (the `vercel` playbook above). That only works when
   every name has a newer in-force row on another provider. These three do not, so removing the
   `SEED_PLATFORM_COSTS` row would make every by-name read 500 `No platform cost configured` —
   exactly the "goes dark" case that section warns about. The `instantly` platform row and
   `PROVIDER_DOMAINS` entry are KEPT deliberately, and both tiers stay declared so no plan
   switch can resurrect a price.

The column is nullable as of migration `0008`. Regressions:
`tests/unit/instantly-email-costs.test.ts` (seed declares null, never zero, name never dropped),
`tests/integration/cold-email-delisting.test.ts` (absent from both listings, resolvable by name,
history intact, no fall-through to a superseded price, 5× marked-up vs 1× pass-through),
`tests/integration/seed-append-history.test.ts` AC7/AC8 (delisting appends and is idempotent).

The infra model these lines were priced on (2026-07, prewarmed inboxes: $15/yr domain hosting 5
accounts at $10/mo, 30 sends/business-day, $47/mo global deliverability tool folded into the
account row) is kept in the seed comments as the record of how the frozen rows were derived. If
the spend ever goes back on the rebill, that is a new priced version on the same names — not a
new name.

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
