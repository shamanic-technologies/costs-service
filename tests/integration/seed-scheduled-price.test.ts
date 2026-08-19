import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { and, eq, desc } from "drizzle-orm";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts, SEED_PROVIDERS_COSTS } from "../../src/db/seed.js";
import { db } from "../../src/db/index.js";
import { providersCosts } from "../../src/db/schema.js";

// A vendor can announce a price change ahead of time (DeepSeek's peak/off-peak schedule starts
// 2026-08-16T16:00Z). The seed expresses that as a SECOND price point for the same cost name,
// dated at the moment the new rate starts. Two things must hold, and neither did before the
// seed learned about scheduled versions:
//
//   - the future row is stored but NOT served until its date arrives, and
//   - the compare-to-latest that appends on a price change must ignore it, or every boot
//     would see "latest != seed" and append a row that reverts the schedule.
//
// Without the fix the second seed run appends a spurious now()-dated row (AC2/AC3 fail red).
describe("Seed scheduled (future-dated) price points", { timeout: 30_000 }, () => {
  const app = createTestApp();

  const SCHEDULED_NAME = "deepseek-v4-flash-peak-tokens-input";

  async function versionsOf(name: string) {
    return db
      .select()
      .from(providersCosts)
      .where(
        and(
          eq(providersCosts.name, name),
          eq(providersCosts.planTier, "pay-as-you-go"),
          eq(providersCosts.billingCycle, "monthly")
        )
      )
      .orderBy(desc(providersCosts.effectiveFrom));
  }

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  // What a fresh seed writes for one cost name, derived from the catalog rather than hardcoded:
  // one row per version dated in the future, plus the single newest version already in force.
  // Deriving it keeps these assertions true on both sides of a schedule's start — hardcoding
  // the DeepSeek dates made the suite pass until 2026-08-16T16:00Z and fail forever after,
  // reporting a break on the day the announced change simply arrived.
  function declaredVersions(name: string) {
    return SEED_PROVIDERS_COSTS.filter(
      (c) => c.name === name && c.planTier === "pay-as-you-go" && c.billingCycle === "monthly"
    ).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  }

  function expectedFreshRows(name: string, now = new Date()) {
    const versions = declaredVersions(name);
    const scheduled = versions.filter((c) => c.effectiveFrom > now);
    const newestInForce = versions.find((c) => c.effectiveFrom <= now);
    return [...scheduled, ...(newestInForce ? [newestInForce] : [])];
  }

  it("AC1: stores every declared price point a fresh database can hold, each at its declared date", async () => {
    await seedProvidersCosts();

    const expected = expectedFreshRows(SCHEDULED_NAME);
    const rows = await versionsOf(SCHEDULED_NAME);

    expect(rows).toHaveLength(expected.length);
    expect(rows.map((r) => r.effectiveFrom.toISOString())).toEqual(
      expected.map((c) => c.effectiveFrom.toISOString())
    );
    expect(rows.map((r) => r.costPerUnitInUsdCents)).toEqual(
      expected.map((c) => c.costPerUnitInUsdCents)
    );
    expect(rows[0].pricingRegime).toBe("peak");
    expect(rows[0].regimeHoursUtc).toBe("01:00-04:00,06:00-10:00");
  });

  it("AC2: re-seeding is a no-op — no version is duplicated", async () => {
    await seedProvidersCosts();
    const afterFirst = (await versionsOf(SCHEDULED_NAME)).length;
    await seedProvidersCosts();
    await seedProvidersCosts();

    expect(await versionsOf(SCHEDULED_NAME)).toHaveLength(afterFirst);
  });

  it("AC3: no seed run invents a row on a date the catalog never declared", async () => {
    // The bug this guards: comparing the seed's in-force value against the LATEST row of any
    // date sees a future price, decides the catalog drifted, and appends a now()-dated row —
    // silently cancelling the announced change. Such a row is recognisable by its date: it is
    // one no seed entry declares.
    await seedProvidersCosts();
    await seedProvidersCosts();

    const declaredDates = new Set(
      SEED_PROVIDERS_COSTS.map((c) => c.effectiveFrom.toISOString())
    );
    const rows = await db.select().from(providersCosts);
    const undeclared = rows.filter((r) => !declaredDates.has(r.effectiveFrom.toISOString()));

    expect(undeclared.map((r) => `${r.name}@${r.effectiveFrom.toISOString()}`)).toEqual([]);
  });

  it("AC4: serves the price in force now, not the scheduled one", async () => {
    await seedProvidersCosts();
    await seedPlatformCosts();

    const res = await request(app).get(`/v1/platform-prices/${SCHEDULED_NAME}`);

    expect(res.status).toBe(200);
    const inForce = declaredVersions(SCHEDULED_NAME).find((c) => c.effectiveFrom <= new Date());
    expect(res.body.pricePerUnitInUsdCents).toBe(inForce!.costPerUnitInUsdCents);
    expect(res.body.pricingRegime).toBe("peak");
    expect(res.body.regimeHoursUtc).toBe("01:00-04:00,06:00-10:00");
  });

  it("AC5: every priced dimension of the four direct-vendor models resolves publicly", async () => {
    await seedProvidersCosts();
    await seedPlatformCosts();

    const names = [
      ...["deepseek-v4-flash", "deepseek-v4-pro"].flatMap((model) =>
        ["peak", "off-peak"].flatMap((regime) =>
          ["tokens-input", "tokens-cached-input", "tokens-output"].map(
            (cls) => `${model}-${regime}-${cls}`
          )
        )
      ),
      ...["zai-glm-4.7-flashx", "zai-glm-5.2"].flatMap((model) =>
        ["tokens-input", "tokens-cached-input", "tokens-output"].map((cls) => `${model}-${cls}`)
      ),
    ];

    for (const name of names) {
      const res = await request(app).get(`/v1/platform-prices/${name}`);
      expect(res.status, name).toBe(200);
      expect(Number(res.body.pricePerUnitInUsdCents), name).toBeGreaterThan(0);
    }
  });

  it("AC6: a Z.ai price reports no regime, so a consumer knows the clock is irrelevant", async () => {
    await seedProvidersCosts();
    await seedPlatformCosts();

    const res = await request(app).get("/v1/platform-prices/zai-glm-5.2-tokens-cached-input");

    expect(res.status).toBe(200);
    expect(res.body.pricingRegime).toBeNull();
    expect(res.body.regimeHoursUtc).toBeNull();
    expect(res.body.pricePerUnitInUsdCents).toBe("0.0001040000"); // $0.26/MTok × 4
  });
});
