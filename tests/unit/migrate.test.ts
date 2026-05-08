import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock for drizzle migrator so we can assert it is (or isn't) called.
const migrateSpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: migrateSpy }));

const fakeDb = {} as Parameters<typeof import("../../src/db/migrate.js")["runMigrationsIfNeeded"]>[0];

type CountRow = { count: number };

function makeSqlStub(scripted: Array<CountRow[]>): import("postgres").Sql {
  let call = 0;
  const fn = () => {
    const result = scripted[call];
    call += 1;
    if (!result) {
      throw new Error(`Unexpected sql call #${call}`);
    }
    return Promise.resolve(result);
  };
  return fn as unknown as import("postgres").Sql;
}

beforeEach(() => {
  migrateSpy.mockClear();
});

describe("runMigrationsIfNeeded", () => {
  it("skips migrate when recorded count matches journal length", async () => {
    const { runMigrationsIfNeeded } = await import("../../src/db/migrate.js");
    const journalLen = await import("../../drizzle/meta/_journal.json", {
      with: { type: "json" },
    }).then((m) => (m.default as { entries: unknown[] }).entries.length);

    const sqlStub = makeSqlStub([[{ count: 1 }], [{ count: journalLen }]]);
    await runMigrationsIfNeeded(fakeDb, sqlStub);

    expect(migrateSpy).not.toHaveBeenCalled();
  });

  it("skips migrate when recorded count exceeds journal length (DB ahead of code)", async () => {
    const { runMigrationsIfNeeded } = await import("../../src/db/migrate.js");
    const journalLen = await import("../../drizzle/meta/_journal.json", {
      with: { type: "json" },
    }).then((m) => (m.default as { entries: unknown[] }).entries.length);

    const sqlStub = makeSqlStub([[{ count: 1 }], [{ count: journalLen + 1 }]]);
    await runMigrationsIfNeeded(fakeDb, sqlStub);

    expect(migrateSpy).not.toHaveBeenCalled();
  });

  it("runs migrate on a fresh DB (no drizzle bookkeeping table)", async () => {
    const { runMigrationsIfNeeded } = await import("../../src/db/migrate.js");

    // Bookkeeping table does not exist -> recorded count short-circuits to 0.
    const sqlStub = makeSqlStub([[{ count: 0 }]]);
    await runMigrationsIfNeeded(fakeDb, sqlStub);

    expect(migrateSpy).toHaveBeenCalledOnce();
    expect(migrateSpy).toHaveBeenCalledWith(fakeDb, { migrationsFolder: "./drizzle" });
  });

  it("runs migrate when DB is behind the journal", async () => {
    const { runMigrationsIfNeeded } = await import("../../src/db/migrate.js");
    const journalLen = await import("../../drizzle/meta/_journal.json", {
      with: { type: "json" },
    }).then((m) => (m.default as { entries: unknown[] }).entries.length);

    const sqlStub = makeSqlStub([[{ count: 1 }], [{ count: journalLen - 1 }]]);
    await runMigrationsIfNeeded(fakeDb, sqlStub);

    expect(migrateSpy).toHaveBeenCalledOnce();
  });
});
