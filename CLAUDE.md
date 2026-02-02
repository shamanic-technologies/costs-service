# Project rules

## README must stay in sync

The `README.md` documents the project's API, setup, and unit costs catalog. **Any change that affects documented behavior must include a corresponding README update in the same commit.**

### Unit costs catalog (mandatory sync)

When adding, updating, or removing a unit cost in `src/db/seed.ts`, **you must update the "Unit costs catalog" table in `README.md`** in the same commit. CI will block the PR if they're out of sync.

Checklist:
- New cost added to `SEED_COSTS` array? Add a row to the README table with: name, cost value, unit description, and provider.
- Cost value changed? Update the matching row in the README table.
- Cost removed from `SEED_COSTS`? Remove the matching row from the README table.
- Run `npm run check:readme` to verify before committing.

### API changes

When adding, modifying, or removing API endpoints in `src/routes/`, update the API table in `README.md`.

### Naming convention: `{provider}-{service-or-model}-{unit-type}`

## Mandatory regression tests

Every bugfix or issue resolution **must** include a regression test that:

1. **Reproduces the bug** — the test must fail without the fix applied.
2. **Passes with the fix** — confirms the fix works.
3. **Lives in the right place**:
   - Unit tests → `tests/unit/<feature>.test.ts`
   - Integration tests → `tests/integration/<feature>.test.ts`
4. **Uses a descriptive name** that references the issue, e.g. `it("should not return stale cost after update (issue #12)")`.

All tests run in CI (`npm run test:unit` and `npm run test:integration`). A PR without a regression test for a bugfix will be considered incomplete.

When adding a **new feature** (not just a fix), also add tests covering the happy path and main edge cases.

## Validation

Run `npm run check:readme` to verify the README costs table matches `src/db/seed.ts`. This also runs in CI on every PR.
