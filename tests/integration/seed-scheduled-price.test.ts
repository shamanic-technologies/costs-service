import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { and, eq, desc } from "drizzle-orm";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, closeDb } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";
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
  const PRE_SCHEDULE = "2025-01-01T00:00:00.000Z";
  const SCHEDULE_START = "2026-08-16T16:00:00.000Z";

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

  it("AC1: stores both price points of a scheduled change, each at its declared date", async () => {
    await seedProvidersCosts();

    const rows = await versionsOf(SCHEDULED_NAME);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.effectiveFrom.toISOString())).toEqual([SCHEDULE_START, PRE_SCHEDULE]);
    expect(rows[0].costPerUnitInUsdCents).toBe("0.0001760000"); // $0.44/MTok × 4
    expect(rows[1].costPerUnitInUsdCents).toBe("0.0000560000"); // $0.14/MTok × 4
    expect(rows[0].pricingRegime).toBe("peak");
    expect(rows[0].regimeHoursUtc).toBe("01:00-04:00,06:00-10:00");
  });

  it("AC2: re-seeding is a no-op — the scheduled row is not duplicated", async () => {
    await seedProvidersCosts();
    await seedProvidersCosts();
    await seedProvidersCosts();

    expect(await versionsOf(SCHEDULED_NAME)).toHaveLength(2);
  });

  it("AC3: a scheduled row does not look like a price change and get reverted on the next boot", async () => {
    // The bug this guards: comparing the seed's in-force value against the LATEST row of any
    // date sees the future $0.44 row, decides the catalog drifted, and appends a now()-dated
    // $0.14 row — silently cancelling the announced change.
    await seedProvidersCosts();
    await seedProvidersCosts();

    // Only the two declared dates may exist — a now()-dated row would be the revert.
    const rows = await versionsOf(SCHEDULED_NAME);
    expect(rows.map((r) => r.effectiveFrom.toISOString()).sort()).toEqual([
      PRE_SCHEDULE,
      SCHEDULE_START,
    ]);
  });

  it("AC4: serves the price in force now, not the scheduled one", async () => {
    await seedProvidersCosts();
    await seedPlatformCosts();

    const res = await request(app).get(`/v1/platform-prices/${SCHEDULED_NAME}`);

    expect(res.status).toBe(200);
    // The schedule starts 2026-08-16T16:00Z; until then the current uniform rate is in force.
    const inForce = new Date() >= new Date(SCHEDULE_START) ? "0.0001760000" : "0.0000560000";
    expect(res.body.pricePerUnitInUsdCents).toBe(inForce);
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
