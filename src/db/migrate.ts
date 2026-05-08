import { readFile } from "fs/promises";
import path from "path";
import type postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const MIGRATIONS_FOLDER = "./drizzle";
const JOURNAL_PATH = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");

type Journal = { entries: { idx: number; tag: string }[] };

async function readJournalEntryCount(): Promise<number> {
  const raw = await readFile(JOURNAL_PATH, "utf-8");
  const journal = JSON.parse(raw) as Journal;
  return journal.entries.length;
}

async function readRecordedMigrationCount(sql: postgres.Sql): Promise<number> {
  // Returns 0 if the drizzle bookkeeping schema/table does not exist yet (fresh DB).
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  `;
  if (rows[0].count === 0) {
    return 0;
  }
  const counts = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `;
  return counts[0].count;
}

/**
 * Runs drizzle migrations only when the database is behind the local journal.
 *
 * Why: drizzle's built-in migrator compares hashes per migration file. We hit a
 * production case where every migration was already applied (rows present in
 * `drizzle.__drizzle_migrations`) yet the recorded hash diverged from the
 * locally-computed hash, so the migrator tried to re-run an already-applied
 * rename and crashed startup with `relation "cost_units" does not exist`.
 *
 * Behaviour: count rows in `drizzle.__drizzle_migrations` and compare to the
 * number of entries in `drizzle/meta/_journal.json`. If recorded >= journal,
 * skip — the schema is at least as new as the deployed code. Otherwise delegate
 * to drizzle's migrator to apply pending migrations.
 */
export async function runMigrationsIfNeeded(
  db: PostgresJsDatabase<Record<string, unknown>>,
  sql: postgres.Sql
): Promise<void> {
  const [journalCount, recordedCount] = await Promise.all([
    readJournalEntryCount(),
    readRecordedMigrationCount(sql),
  ]);

  if (recordedCount >= journalCount) {
    console.log(
      `[costs-service] Migrations up-to-date (${recordedCount}/${journalCount} recorded), skipping migrate`
    );
    return;
  }

  console.log(
    `[costs-service] Applying migrations (${recordedCount}/${journalCount} recorded)`
  );
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export const __test__ = { readJournalEntryCount, readRecordedMigrationCount };
