import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost, insertPlatformCost, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts, SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS } from "../../src/db/seed.js";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { providersCosts, platformCosts } from "../../src/db/schema.js";

describe("Seed cleanup", { timeout: 30_000 }, () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("should remove stale plan_tier rows from providers_costs after seeding", async () => {
    // Reproduce the bug: insert a cost with a stale plan_tier ("default")
    // and a later effective_from so it takes priority over the correct one
    await insertTestProviderCost({
      name: "firecrawl-map-credit",
      provider: "firecrawl",
      planTier: "default",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "0.6333333333",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });

    await insertPlatformCost({
      provider: "firecrawl",
      planTier: "default",
      billingCycle: "monthly",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });

    // Before seed: GET should resolve to the "default" plan (wrong)
    const beforeRes = await request(app)
      .get("/v1/providers-costs/firecrawl-map-credit")
      .set(identityHeaders);
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.planTier).toBe("default");

    // Run seed — should insert correct rows AND remove stale ones
    await seedProvidersCosts();
    await seedPlatformCosts();

    // After seed: stale "default" rows should be gone, correct "hobby" row should resolve
    const afterRes = await request(app)
      .get("/v1/providers-costs/firecrawl-map-credit")
      .set(identityHeaders);
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.planTier).toBe("hobby");
  });

  it("should remove stale plan_tier rows from platform_costs after seeding", async () => {
    // Insert a stale platform cost with "default" plan_tier
    await insertPlatformCost({
      provider: "anthropic",
      planTier: "default",
      billingCycle: "monthly",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });

    await seedPlatformCosts();

    // Verify only the correct plan_tier remains
    const rows = await db
      .select()
      .from(platformCosts)
      .where(eq(platformCosts.provider, "anthropic"));

    expect(rows.every((r) => r.planTier === "pay-as-you-go")).toBe(true);
    expect(rows.some((r) => r.planTier === "default")).toBe(false);
  });

  it("should update platform_costs plan_tier when seed value differs from existing row", async () => {
    // Reproduce the bug: insert a platform cost with a stale plan_tier.
    // The unique key is (provider, effective_from), so onConflictDoNothing
    // would skip the insert, then cleanup deletes the old row,
    // leaving NO row for that provider.
    await insertPlatformCost({
      provider: "postmark",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedPlatformCosts();

    // After seed: platform_costs should have the seed's plan_tier ("pro"), not be deleted
    const rows = await db
      .select()
      .from(platformCosts)
      .where(eq(platformCosts.provider, "postmark"));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.planTier === "pro-10k")).toBe(true);
    expect(rows.some((r) => r.planTier === "pay-as-you-go")).toBe(false);
  });

  it("should keep all plan tiers for a cost name with multiple plans", async () => {
    await seedProvidersCosts();

    // postmark-email-send should have 3 plan tiers: basic, pro, platform
    const rows = await db
      .select()
      .from(providersCosts)
      .where(eq(providersCosts.name, "postmark-email-send"));

    const tiers = rows.map((r) => r.planTier).sort();
    expect(tiers).toEqual(["basic-10k", "platform-10k", "pro-10k"]);
  });

  it("should update providers_costs cost value when seed value differs from existing row", async () => {
    // Insert a provider cost with a different cost value than the seed
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

    // After seed: cost value should be updated to match the seed
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

  it("should remove provider cost rows with unknown names after seeding", async () => {
    // Insert a cost with a name not in the seed
    await insertTestProviderCost({
      name: "unknown-service-credit",
      provider: "unknown",
      planTier: "basic",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "1.0000000000",
    });

    await seedProvidersCosts();

    const res = await request(app)
      .get("/v1/providers-costs/unknown-service-credit")
      .set(identityHeaders);
    expect(res.status).toBe(404);
  });
});
