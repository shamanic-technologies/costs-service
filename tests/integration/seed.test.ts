import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost, insertPlatformCost, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts, SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS } from "../../src/db/seed.js";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { providersCosts, platformCosts } from "../../src/db/schema.js";

describe("Seed upsert", { timeout: 30_000 }, () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("should resolve the seed plan_tier after seeding appends the corrected platform row", async () => {
    // Insert a platform cost with a stale plan_tier; seeding appends the corrected one,
    // and the read path resolves the newest (effective_from <= now()) platform row.
    await insertPlatformCost({
      provider: "firecrawl",
      planTier: "default",
      billingCycle: "monthly",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await insertTestProviderCost({
      name: "firecrawl-map-credit",
      provider: "firecrawl",
      planTier: "default",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "0.6333333333",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    // Before seed: API resolves to stale "default" plan
    const beforeRes = await request(app)
      .get("/v1/providers-costs/firecrawl-map-credit")
      .set(identityHeaders);
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.planTier).toBe("default");

    // Seed upserts correct rows; ON CONFLICT updates plan_tier from "default" to "hobby"
    await seedProvidersCosts();
    await seedPlatformCosts();

    // After seed: API resolves to correct "hobby" plan
    const afterRes = await request(app)
      .get("/v1/providers-costs/firecrawl-map-credit")
      .set(identityHeaders);
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.planTier).toBe("hobby");
  });

  it("should APPEND a new dated platform_costs row when seed plan_tier differs from latest", async () => {
    // Insert a platform cost with a stale plan_tier for postmark.
    await insertPlatformCost({
      provider: "postmark",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedPlatformCosts();

    const rows = await db
      .select()
      .from(platformCosts)
      .where(eq(platformCosts.provider, "postmark"))
      .orderBy(desc(platformCosts.effectiveFrom));

    // Append-only: stale "pay-as-you-go" preserved, new "pro-10k" appended on top.
    expect(rows.length).toBe(2);
    expect(rows[0].planTier).toBe("pro-10k");
    expect(rows.some((r) => r.planTier === "pay-as-you-go")).toBe(true);
  });

  it("should keep all plan tiers for a cost name with multiple plans", async () => {
    await seedProvidersCosts();

    // postmark-email-send should have 3 plan tiers: basic-10k, pro-10k, platform-10k
    const rows = await db
      .select()
      .from(providersCosts)
      .where(eq(providersCosts.name, "postmark-email-send"));

    const tiers = rows.map((r) => r.planTier).sort();
    expect(tiers).toEqual(["basic-10k", "platform-10k", "pro-10k"]);
  });

  it("should APPEND a new dated row (never overwrite) when seed cost differs from latest", async () => {
    const seedCost = SEED_PROVIDERS_COSTS.find((c) => c.name === "postmark-email-send")!;
    const staleValue = "0.9900000000";
    await insertTestProviderCost({
      name: seedCost.name,
      provider: seedCost.provider,
      planTier: seedCost.planTier,
      billingCycle: seedCost.billingCycle,
      costPerUnitInUsdCents: staleValue, // differs from the seed value
      effectiveFrom: seedCost.effectiveFrom,
    });

    await seedProvidersCosts();

    const rows = await db
      .select()
      .from(providersCosts)
      .where(
        and(
          eq(providersCosts.name, seedCost.name),
          eq(providersCosts.planTier, seedCost.planTier),
          eq(providersCosts.billingCycle, seedCost.billingCycle)
        )
      )
      .orderBy(desc(providersCosts.effectiveFrom));

    // Append-only: the stale row is preserved and a new dated row carries the seed value.
    expect(rows.length).toBe(2);
    expect(rows[0].costPerUnitInUsdCents).toBe(seedCost.costPerUnitInUsdCents);
    expect(rows.some((r) => r.costPerUnitInUsdCents === staleValue)).toBe(true);
  });

  it("should verify provider costs row count after seeding (seed verification)", async () => {
    await seedProvidersCosts();

    const rows = await db.select().from(providersCosts);
    expect(rows.length).toBeGreaterThanOrEqual(SEED_PROVIDERS_COSTS.length);
  });

  it("should verify platform costs row count after seeding (seed verification)", async () => {
    await seedPlatformCosts();

    const rows = await db.select().from(platformCosts);
    expect(rows.length).toBeGreaterThanOrEqual(SEED_PLATFORM_COSTS.length);
  });

  it("every SEED_PROVIDERS_COSTS row defines provider, type, unit", () => {
    for (const c of SEED_PROVIDERS_COSTS) {
      expect(c.provider, `seed row ${c.name} missing provider`).toBeTruthy();
      expect((c as any).type, `seed row ${c.name} missing type`).toBeTruthy();
      expect((c as any).unit, `seed row ${c.name} missing unit`).toBeTruthy();
    }
  });

  it("seed populates type, unit, providerDomain in DB rows", async () => {
    await seedProvidersCosts();

    const rows = await db.select().from(providersCosts);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.type, `row ${r.name} has null type`).toBeTruthy();
      expect(r.unit, `row ${r.name} has null unit`).toBeTruthy();
    }

    // Spot check: at least one row has providerDomain set
    const withDomain = rows.filter((r) => r.providerDomain != null);
    expect(withDomain.length).toBeGreaterThan(0);
  });

  it("should verify all seed names are present after seeding", async () => {
    await seedProvidersCosts();

    const rows = await db.select({ name: providersCosts.name }).from(providersCosts);
    const names = new Set(rows.map((r) => r.name));
    const seedNames = [...new Set(SEED_PROVIDERS_COSTS.map((c) => c.name))];
    for (const name of seedNames) {
      expect(names.has(name), `expected seed name "${name}" to be in DB`).toBe(true);
    }
  });

  it("should not lose data when two seed calls run concurrently (multi-replica safety)", async () => {
    const [resultA, resultB] = await Promise.allSettled([
      seedProvidersCosts(),
      seedProvidersCosts(),
    ]);

    const succeeded = [resultA, resultB].filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const rows = await db.select().from(providersCosts);
    expect(rows.length).toBeGreaterThanOrEqual(SEED_PROVIDERS_COSTS.length);
  });

  it("should not lose data when two seed calls run concurrently (platform costs)", async () => {
    const [resultA, resultB] = await Promise.allSettled([
      seedPlatformCosts(),
      seedPlatformCosts(),
    ]);

    const succeeded = [resultA, resultB].filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const rows = await db.select().from(platformCosts);
    expect(rows.length).toBeGreaterThanOrEqual(SEED_PLATFORM_COSTS.length);
  });

  it("should not return unknown costs via API even if orphan rows exist", async () => {
    // Insert a cost with a name not in the seed — the seed won't delete it,
    // but the API should return 404 because there's no matching platform_costs entry
    await insertTestProviderCost({
      name: "unknown-service-credit",
      provider: "unknown",
      planTier: "basic",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "1.0000000000",
    });

    await seedProvidersCosts();
    await seedPlatformCosts();

    // API filters by platform plan — "unknown" provider has no platform_costs entry
    const res = await request(app)
      .get("/v1/providers-costs/unknown-service-credit")
      .set(identityHeaders);
    expect(res.status).toBe(500); // "No platform cost configured for provider 'unknown'"
  });
});
