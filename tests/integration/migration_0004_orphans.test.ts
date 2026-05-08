import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sql } from "../../src/db/index.js";
import { cleanTestData, closeDb } from "../helpers/test-db.js";

// Regression for migration 0004 production failure (PR #97):
//
// Before this fix, migration 0004's NULL precheck raised
// "Migration 0004: 15 providers_costs rows still have NULL type/unit"
// because prior renames (apollo split, scrape-do split, instantly split,
// gemini→google rename, anthropic-opus naming) left orphan rows in
// providers_costs whose names are no longer in the seed catalog. The seed
// only UPSERTs and never DELETEs, so orphans accumulated and blocked the
// NOT NULL lock.
//
// The fix adds:
//   DELETE FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL;
// before the NULL precheck, removing stale orphans so the lock succeeds.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATION_PATH = path.resolve(__dirname, "../../drizzle/0004_add_provider_metadata.sql");

describe("migration 0004 orphan cleanup (issue: prod deploy blocked)", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    // Drop NOT NULL so we can insert orphan rows with raw SQL.
    await sql.unsafe(`ALTER TABLE providers_costs ALTER COLUMN type DROP NOT NULL`);
    await sql.unsafe(`ALTER TABLE providers_costs ALTER COLUMN unit DROP NOT NULL`);
  });

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    // Restore NOT NULL so subsequent integration tests see post-migration schema.
    await sql.unsafe(`ALTER TABLE providers_costs ALTER COLUMN type SET NOT NULL`);
    await sql.unsafe(`ALTER TABLE providers_costs ALTER COLUMN unit SET NOT NULL`);
    await closeDb();
  });

  it("0004 SQL file contains the orphan DELETE before the NULL precheck", () => {
    const text = readFileSync(MIGRATION_PATH, "utf-8");

    const deleteIdx = text.indexOf(
      `DELETE FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL`
    );
    const checkIdx = text.indexOf("Migration 0004:");

    expect(deleteIdx, "0004 must contain orphan DELETE statement").toBeGreaterThan(-1);
    expect(checkIdx, "0004 must contain NULL precheck RAISE").toBeGreaterThan(-1);
    expect(deleteIdx, "DELETE must run before the NULL precheck").toBeLessThan(checkIdx);
  });

  it("orphan row with NULL type is deleted by the cleanup statement", async () => {
    await sql.unsafe(`
      INSERT INTO providers_costs (name, provider, plan_tier, billing_cycle, cost_per_unit_in_usd_cents, type, unit, effective_from)
      VALUES ('orphan-null-type', 'unknown-provider', 'basic', 'monthly', '1.0000000000', NULL, 'credit', now())
    `);

    await sql.unsafe(`DELETE FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL`);

    const rows = await sql.unsafe(
      `SELECT name FROM providers_costs WHERE name = 'orphan-null-type'`
    );
    expect(rows.length).toBe(0);
  });

  it("orphan row with NULL unit is deleted by the cleanup statement", async () => {
    await sql.unsafe(`
      INSERT INTO providers_costs (name, provider, plan_tier, billing_cycle, cost_per_unit_in_usd_cents, type, unit, effective_from)
      VALUES ('orphan-null-unit', 'unknown-provider', 'basic', 'monthly', '1.0000000000', 'Credit', NULL, now())
    `);

    await sql.unsafe(`DELETE FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL`);

    const rows = await sql.unsafe(
      `SELECT name FROM providers_costs WHERE name = 'orphan-null-unit'`
    );
    expect(rows.length).toBe(0);
  });

  it("valid row with both type and unit set is preserved", async () => {
    await sql.unsafe(`
      INSERT INTO providers_costs (name, provider, plan_tier, billing_cycle, cost_per_unit_in_usd_cents, type, unit, effective_from)
      VALUES ('valid-cost', 'apollo', 'basic', 'monthly', '2.3600000000', 'Credit', 'credit', now())
    `);

    await sql.unsafe(`DELETE FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL`);

    const rows = await sql.unsafe(
      `SELECT name, type, unit FROM providers_costs WHERE name = 'valid-cost'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("Credit");
    expect(rows[0].unit).toBe("credit");
  });

  it("the 15 production orphan names from PR #97 deploy failure are all cleaned", async () => {
    const PROD_ORPHAN_NAMES = [
      "anthropic-opus-4-6-input-token",
      "anthropic-opus-4-6-output-token",
      "apollo-enrichment-credit",
      "apollo-person-match-credit",
      "apollo-search-credit",
      "gemini-3-flash-tokens-input",
      "gemini-3-flash-tokens-output",
      "gemini-3.1-flash-lite-tokens-input",
      "gemini-3.1-flash-lite-tokens-output",
      "gemini-3.1-pro-google-search-query",
      "gemini-google-search-query",
      "instantly-email-send",
      "scrape-do-render-credit",
      "scrape-do-render-super-credit",
      "scrape-do-scrape-credit",
    ];

    const valuesClause = PROD_ORPHAN_NAMES.map(
      (name) =>
        `('${name}', 'legacy', 'basic', 'monthly', '1.0000000000', NULL, NULL, now())`
    ).join(", ");

    await sql.unsafe(`
      INSERT INTO providers_costs (name, provider, plan_tier, billing_cycle, cost_per_unit_in_usd_cents, type, unit, effective_from)
      VALUES ${valuesClause}
    `);

    await sql.unsafe(`DELETE FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL`);

    const remaining = await sql.unsafe<{ count: number }[]>(
      `SELECT count(*)::int as count FROM providers_costs WHERE name = ANY($1)`,
      [PROD_ORPHAN_NAMES]
    );
    expect(remaining[0].count).toBe(0);
  });

  it("re-running the cleanup is idempotent (no error on empty result)", async () => {
    await sql.unsafe(`DELETE FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL`);
    await sql.unsafe(`DELETE FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL`);
  });
});
