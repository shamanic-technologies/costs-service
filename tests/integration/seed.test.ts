import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost, insertPlatformCost, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts, SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS } from "../../src/db/seed.js";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { providersCosts, platformCosts } from "../../src/db/schema.js";

describe("Seed cleanup", () => {
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
