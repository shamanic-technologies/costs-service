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

## Validation

Run `npm run check:readme` to verify the README costs table matches `src/db/seed.ts`. This also runs in CI on every PR.
