import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost, insertPlatformCost, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts, SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS } from "../../src/db/seed.js";
import { eq } from "drizzle-orm";
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

  it("should update stale plan_tier via upsert when effective_from matches", async () => {
    // Insert a platform cost with wrong plan_tier but same unique key (provider, effective_from)
    await insertPlatformCost({
      provider: "firecrawl",
      planTier: "default",
      billingCycle: "monthly",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"), // same as seed
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

  it("should update platform_costs plan_tier when seed value differs from existing row", async () => {
    // Insert a platform cost with stale plan_tier for same unique key (provider, effective_from)
    await insertPlatformCost({
      provider: "postmark",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedPlatformCosts();

    // Upsert should have updated the plan_tier to "pro-10k"
    const rows = await db
      .select()
      .from(platformCosts)
      .where(eq(platformCosts.provider, "postmark"));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.planTier === "pro-10k")).toBe(true);
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

  it("should update providers_costs cost value when seed value differs from existing row", async () => {
    const seedCost = SEED_PROVIDERS_COSTS.find((c) => c.name === "postmark-email-send")!;
    await insertTestProviderCost({
      name: seedCost.name,
      provider: seedCost.provider,
      planTier: seedCost.planTier,
      billingCycle: seedCost.billingCycle,
      costPerUnitInUsdCents: "0.9900000000", // wrong value
      effectiveFrom: seedCost.effectiveFrom,
    });

    await seedProvidersCosts();

    const rows = await db
      .select()
      .from(providersCosts)
      .where(eq(providersCosts.name, "postmark-email-send"));

    const matchingRow = rows.find(
      (r) => r.planTier === seedCost.planTier && r.billingCycle === seedCost.billingCycle
    );
    expect(matchingRow).toBeDefined();
    expect(matchingRow!.costPerUnitInUsdCents).toBe(seedCost.costPerUnitInUsdCents);
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
