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
import {
  seedProvidersCosts,
  seedPlatformCosts,
  SEED_PROVIDERS_COSTS,
  DEEPSEEK_PEAK_HOURS_UTC,
} from "../../src/db/seed.js";
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
    // anthropic-web-search is a marked-up line: the store markup went 4× → 5× when the
    // cold-email lines stopped being rebilled, so its 4¢ row must be preserved as history and
    // the 5¢ row appended — spend already declared still reads back at 4¢.
    await insertTestProviderCost({
      name: "anthropic-web-search",
      provider: "anthropic",
      providerDomain: "anthropic.com",
      type: "Web search",
      unit: "search",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "4.0000000000", // the 4x-markup price
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedProvidersCosts(); // seed now carries 5.0000000000 (1¢ vendor × 5) → must APPEND

    const rows = await db
      .select()
      .from(providersCosts)
      .where(
        and(
          eq(providersCosts.name, "anthropic-web-search"),
          eq(providersCosts.planTier, "pay-as-you-go"),
          eq(providersCosts.billingCycle, "monthly")
        )
      )
      .orderBy(desc(providersCosts.effectiveFrom));

    expect(rows.length).toBe(2); // history preserved, not overwritten
    expect(rows[0].costPerUnitInUsdCents).toBe("5.0000000000"); // newest = 5x markup
    expect(rows[1].costPerUnitInUsdCents).toBe("4.0000000000"); // old value still queryable
    expect(rows[1].effectiveFrom.getTime()).toBeLessThan(rows[0].effectiveFrom.getTime());
  });

  it("AC1b: dropping the markup appends a new row even where the NUMBER is unchanged", async () => {
    // The Stripe fees went from marked-up 4¢/cent to pass-through 1¢/cent, so their value moved
    // and a plain value comparison would have caught them. A future line could keep its number
    // and change only its class (a 1× markup dropped, say) — that is still a change in what the
    // customer is promised, so the comparison covers pricing_basis too.
    await insertTestProviderCost({
      name: "stripe-processing-fee",
      provider: "stripe",
      providerDomain: "stripe.com",
      type: "Charge processing fee",
      unit: "USD cent",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "1.0000000000", // same number the seed now declares…
      pricingBasis: "marked-up", // …but the old class
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedProvidersCosts();

    const rows = await db
      .select()
      .from(providersCosts)
      .where(eq(providersCosts.name, "stripe-processing-fee"))
      .orderBy(desc(providersCosts.effectiveFrom));

    expect(rows.length).toBe(2);
    expect(rows[0].pricingBasis).toBe("pass-through");
    expect(rows[0].costPerUnitInUsdCents).toBe("1.0000000000");
    expect(rows[1].pricingBasis).toBe("marked-up"); // history intact
  });

  it("AC9: moving a regime's WINDOWS appends a new row even where the price is unchanged", async () => {
    // A regime row says two things: what the rate is, and when it applies. DeepSeek's
    // 2026-08-23 rule moved the second without touching the first — weekends went off-peak
    // all day — so a comparison on price alone found nothing to write and the seed silently
    // no-op'd. Production kept serving the old schedule and the deploy looked clean, which is
    // the worst shape a pricing bug can take. Fails red without regime_hours_utc in the
    // comparison: one row, old windows, no append.
    //
    // Everything below is DERIVED from the seed rather than typed out, so this test cannot
    // rot into asserting a schedule the catalog no longer declares.
    const name = "deepseek-v4-flash-peak-tokens-input";
    const inForce = SEED_PROVIDERS_COSTS.filter(
      (c) => c.name === name && c.effectiveFrom <= new Date(),
    ).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    expect(inForce, `${name} has no in-force version`).toBeDefined();
    expect(inForce.regimeHoursUtc).toBe(DEEPSEEK_PEAK_HOURS_UTC);

    // The same price and basis the seed declares, under the PRE-weekend windows.
    const supersededWindows = "01:00-04:00,06:00-10:00";
    expect(supersededWindows).not.toBe(DEEPSEEK_PEAK_HOURS_UTC);
    await insertTestProviderCost({
      name,
      provider: inForce.provider,
      providerDomain: inForce.providerDomain ?? null,
      type: inForce.type,
      unit: inForce.unit,
      planTier: inForce.planTier,
      billingCycle: inForce.billingCycle,
      costPerUnitInUsdCents: inForce.costPerUnitInUsdCents!,
      pricingBasis: inForce.pricingBasis,
      pricingRegime: inForce.pricingRegime ?? null,
      regimeHoursUtc: supersededWindows,
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedProvidersCosts();

    const rows = await db
      .select()
      .from(providersCosts)
      .where(eq(providersCosts.name, name))
      .orderBy(desc(providersCosts.effectiveFrom));

    expect(rows.length).toBe(2);
    expect(rows[0].regimeHoursUtc).toBe(DEEPSEEK_PEAK_HOURS_UTC);
    expect(rows[0].costPerUnitInUsdCents).toBe(inForce.costPerUnitInUsdCents); // price untouched
    expect(rows[1].regimeHoursUtc).toBe(supersededWindows); // the old schedule stays queryable
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

  it("AC7: delisting a cold-email line appends a null-priced row and keeps every priced row", async () => {
    // The cold-email infrastructure spend moved onto our own fixed costs, so the line stopped
    // being rebilled. Delisting must not touch the priced rows: runs-service holds historical
    // cost rows under this name and a reconcile sweep still PATCHes old holds by cost id.
    await insertTestProviderCost({
      name: "instantly-account-email-sent",
      provider: "instantly",
      providerDomain: "instantly.ai",
      type: "Email send (per account)",
      unit: "email",
      planTier: "hypergrowth",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "6.5481481480", // the price it was rebilled at
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });

    await seedProvidersCosts();
    await seedPlatformCosts();

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

    expect(rows.length).toBe(2);
    expect(rows[0].costPerUnitInUsdCents).toBeNull(); // newest = no billable price
    expect(rows[1].costPerUnitInUsdCents).toBe("6.5481481480"); // untouched history
    expect(rows[1].effectiveFrom.getTime()).toBeLessThan(rows[0].effectiveFrom.getTime());
  });

  it("AC8: re-seeding a delisted line appends nothing (null is idempotent)", async () => {
    await seedProvidersCosts();
    const after1 = await db
      .select()
      .from(providersCosts)
      .where(eq(providersCosts.name, "instantly-account-email-sent"));
    await seedProvidersCosts();
    const after2 = await db
      .select()
      .from(providersCosts)
      .where(eq(providersCosts.name, "instantly-account-email-sent"));
    expect(after2.length).toBe(after1.length);
  });
});
