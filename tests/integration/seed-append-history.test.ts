import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { and, eq, desc } from "drizzle-orm";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestProviderCost,
  insertPlatformCost,
  closeDb,
} from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";
import { db } from "../../src/db/index.js";
import { providersCosts, platformCosts } from "../../src/db/schema.js";

// Regression for the append-only price-history bug: the seed used ON CONFLICT DO UPDATE,
// so changing a price OVERWROTE the existing row and destroyed history. The seed must now
// APPEND a new dated row when the price differs from the latest, and no-op when it matches.
// Without the fix, AC1/AC6 fail (one row, old value gone); AC2 stays green either way.
describe("Seed append-only price history", { timeout: 30_000 }, () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("AC1: changing a provider cost appends a new dated row and preserves the old (no overwrite)", async () => {
    // Pre-seed the OLD price at the declared effective_from (mirrors prod's 2025-01-01 rows).
    await insertTestProviderCost({
      name: "instantly-account-email-sent",
      provider: "instantly",
      providerDomain: "instantly.ai",
      type: "Email send (per account)",
      unit: "email",
      planTier: "hypergrowth",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "3.3334000000", // old price
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedProvidersCosts(); // seed now carries 6.5481481480 → must APPEND

    const rows = await db
      .select()
      .from(providersCosts)
      .where(
        and(
          eq(providersCosts.name, "instantly-account-email-sent"),
          eq(providersCosts.planTier, "hypergrowth"),
          eq(providersCosts.billingCycle, "monthly")
        )
      )
      .orderBy(desc(providersCosts.effectiveFrom));

    expect(rows.length).toBe(2); // history preserved, not overwritten
    expect(rows[0].costPerUnitInUsdCents).toBe("6.5481481480"); // newest = new price
    expect(rows[1].costPerUnitInUsdCents).toBe("3.3334000000"); // old value still queryable
    expect(rows[1].effectiveFrom.getTime()).toBeLessThan(rows[0].effectiveFrom.getTime());
  });

  it("AC2: re-running the seed with no change appends nothing (idempotent)", async () => {
    await seedProvidersCosts();
    const after1 = await db.select().from(providersCosts);
    await seedProvidersCosts();
    const after2 = await db.select().from(providersCosts);
    expect(after2.length).toBe(after1.length);
  });

  it("AC6: changing the platform plan_tier appends a new dated row and preserves the old", async () => {
    await insertPlatformCost({
      provider: "instantly",
      planTier: "growth",
      billingCycle: "monthly",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedPlatformCosts(); // seed carries hypergrowth → must APPEND

    const rows = await db
      .select()
      .from(platformCosts)
      .where(eq(platformCosts.provider, "instantly"))
      .orderBy(desc(platformCosts.effectiveFrom));

    expect(rows.length).toBe(2);
    expect(rows[0].planTier).toBe("hypergrowth"); // newest
    expect(rows[1].planTier).toBe("growth"); // history preserved
  });

  it("AC7: resolves the repriced instantly email costs after seeding", async () => {
    await seedProvidersCosts();
    await seedPlatformCosts();

    const account = await request(app)
      .get("/v1/platform-prices/instantly-account-email-sent")
      .set(identityHeaders);
    expect(account.status).toBe(200);
    expect(account.body.pricePerUnitInUsdCents).toBe("6.5481481480");

    const domain = await request(app)
      .get("/v1/platform-prices/instantly-domain-email-sent")
      .set(identityHeaders);
    expect(domain.status).toBe(200);
    expect(domain.body.pricePerUnitInUsdCents).toBe("0.1587301588");
  });
});
