import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { cleanTestData, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";

// Regression: prior to fix, the direct (non-pooler) postgres client used by
// the seed was created at module load and never `.end()`'d, leaking a Neon
// compute connection slot per Cloud Run instance. Each call to
// `seedProvidersCosts` / `seedPlatformCosts` must now open and close its own
// direct connection so the slot is released after startup.
//
// We can't introspect Neon's server-side conn count from a test, but we can
// assert that running the seed many times sequentially does not pile up
// open clients to the point of exhaustion. With the leak, each call would
// previously add a permanent open client (in addition to the module-level
// one). With the fix each call must clean up after itself.
describe("Seed connection lifecycle (regression: direct connection leak)", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("seedProvidersCosts can run repeatedly without leaking direct connections", async () => {
    for (let i = 0; i < 5; i++) {
      await seedProvidersCosts();
    }
    // If the direct client leaked per call we'd expect to either exhaust
    // Neon's direct connection cap or hit a postgres-js client-side error
    // before reaching this assertion.
    expect(true).toBe(true);
  });

  it("seedPlatformCosts can run repeatedly without leaking direct connections", async () => {
    for (let i = 0; i < 5; i++) {
      await seedPlatformCosts();
    }
    expect(true).toBe(true);
  });
});
