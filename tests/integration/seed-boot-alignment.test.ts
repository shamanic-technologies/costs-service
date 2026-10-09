import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { asc, eq, sql as dsql } from "drizzle-orm";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertPlatformCost } from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { catalogueSyncs, providerCostVendorCosts, providersCosts } from "../../src/db/schema.js";
import { alignSeedVersionsToProposedList } from "../../src/db/catalogue-sync.js";

// 2026-10-09 (v0.79.0): the Sonnet 5.5 cache-read reprice was billed at the seed's 5x markup
// (0.00005 c/token) from the deploy until the scheduler's first sync 5 minutes later (0.00002).
// The boot now prices every seed version the sync never saw BEFORE the port opens.
const T0 = new Date("2025-01-01T00:00:00Z");

async function clean() {
  for (const t of [catalogueSyncs, providerCostVendorCosts]) await db.delete(t);
  await cleanTestData();
}

async function version(name: string, price: string, vendor: string, effectiveFrom: Date, priceSource: "seed" | "proposed-list" = "seed", createdAt?: Date) {
  const [row] = await db
    .insert(providersCosts)
    .values({ name, provider: "anthropic", planTier: "p", billingCycle: "monthly", type: "t", unit: "token", costPerUnitInUsdCents: price, pricingBasis: "marked-up", priceSource, effectiveFrom, ...(createdAt ? { createdAt } : {}) })
    .returning();
  await db.insert(providerCostVendorCosts).values({
    providerCostId: row.id,
    vendorCostPerUnitInUsdCents: vendor,
    markupMultiplier: (Number(price) / Number(vendor)).toFixed(4),
    derivation: priceSource === "seed" ? "seed-vendor-rate" : "proposed-list",
  });
  return row;
}

const history = (name: string) =>
  db.select().from(providersCosts).where(eq(providersCosts.name, name)).orderBy(asc(providersCosts.effectiveFrom));

describe("boot: seed versions are billed at the proposed list, never at the seed markup", { timeout: 30_000 }, () => {
  const app = createTestApp();
  const headers = getIdentityHeaders();
  const price = async (name: string) => (await request(app).get(`/v1/platform-prices/${name}`).set(headers)).body;

  beforeEach(async () => {
    await clean();
    await insertPlatformCost({ provider: "anthropic", planTier: "p", billingCycle: "monthly", effectiveFrom: T0 });
  });
  afterAll(clean);

  it("does nothing before the first sync: the seed price is then the billed price by design", async () => {
    await version("anthropic-haiku-5.5-tokens-input", "0.0000500000", "0.0000100000", T0);
    expect(await alignSeedVersionsToProposedList()).toMatchObject({ lastSyncStartedAt: null, versionsWritten: 0 });
    expect(await price("anthropic-haiku-5.5-tokens-input")).toMatchObject({ pricePerUnitInUsdCents: "0.0000500000" });
  });

  it("prices a reprice and a new name at vendor x2 at boot, keeps a version the sync kept, and is idempotent", async () => {
    const syncAt = new Date(Date.now() - 3_600_000);
    await version("anthropic-sonnet-5.5-tokens-cached-input", "0.0001250000", "0.0000250000", T0);
    await version("anthropic-sonnet-5.5-tokens-cached-input", "0.0000500000", "0.0000250000", syncAt, "proposed-list");
    // Written by an earlier deploy, before the last sync: the sync saw it and kept it.
    await version("kept-before-sync", "1.0000000000", "0.2000000000", T0, "seed", new Date(syncAt.getTime() - 60_000));
    await db.insert(catalogueSyncs).values({ status: "succeeded", proposedListDay: syncAt.toISOString().slice(0, 10), startedAt: syncAt, finishedAt: syncAt });

    // The deploy: the seed appends the reprice (dated now) and a new name (backdated, written now).
    const seedAt = new Date();
    const repriced = await version("anthropic-sonnet-5.5-tokens-cached-input", "0.0000500000", "0.0000100000", seedAt);
    await version("anthropic-haiku-5.5-tokens-input", "0.0000500000", "0.0000100000", T0);
    // What the old boot served from here until the first sync: the seed's 5x.
    expect(await price("anthropic-sonnet-5.5-tokens-cached-input")).toMatchObject({ pricePerUnitInUsdCents: "0.0000500000" });

    const outcome = await alignSeedVersionsToProposedList();
    expect(outcome).toMatchObject({ candidates: 2, versionsWritten: 2 });
    expect(await price("anthropic-sonnet-5.5-tokens-cached-input")).toMatchObject({ pricePerUnitInUsdCents: "0.0000200000" });
    expect(await price("anthropic-haiku-5.5-tokens-input")).toMatchObject({ pricePerUnitInUsdCents: "0.0000200000" });
    expect(await price("kept-before-sync")).toMatchObject({ pricePerUnitInUsdCents: "1.0000000000" });

    // Append-only, strictly after the seed version, vendor rate carried.
    const rows = await history("anthropic-sonnet-5.5-tokens-cached-input");
    expect(rows.map((r) => [r.costPerUnitInUsdCents, r.priceSource])).toEqual([
      ["0.0001250000", "seed"],
      ["0.0000500000", "proposed-list"],
      ["0.0000500000", "seed"],
      ["0.0000200000", "proposed-list"],
    ]);
    expect(rows[3].effectiveFrom.getTime()).toBeGreaterThan(repriced.effectiveFrom.getTime());
    const [vc] = await db.select().from(providerCostVendorCosts).where(eq(providerCostVendorCosts.providerCostId, rows[3].id));
    expect(vc).toMatchObject({ vendorCostPerUnitInUsdCents: "0.0000100000", derivation: "proposed-list", markupMultiplier: "2.0000" });

    expect(await alignSeedVersionsToProposedList()).toMatchObject({ candidates: 0, versionsWritten: 0 });
  });

  it("prices a scheduled seed version one microsecond after its own date", async () => {
    const syncAt = new Date(Date.now() - 3_600_000);
    await version("deepseek-input", "0.0004000000", "0.0000800000", T0);
    await version("deepseek-input", "0.0001600000", "0.0000800000", syncAt, "proposed-list");
    await db.insert(catalogueSyncs).values({ status: "succeeded", startedAt: syncAt, finishedAt: syncAt });
    const at = new Date(Date.now() + 86_400_000);
    await version("deepseek-input", "0.0003000000", "0.0000600000", at);

    expect(await alignSeedVersionsToProposedList()).toMatchObject({ versionsWritten: 1 });
    expect(await price("deepseek-input")).toMatchObject({ pricePerUnitInUsdCents: "0.0001600000" });
    const [{ gap }] = (await db.execute(dsql`
      SELECT extract(epoch FROM p.effective_from - s.effective_from) * 1e6 AS gap
      FROM providers_costs s JOIN providers_costs p ON p.name = s.name AND p.price_source = 'proposed-list' AND p.effective_from > s.effective_from
      WHERE s.name = 'deepseek-input' AND s.price_source = 'seed' AND s.effective_from > now()
    `)) as unknown as { gap: string }[];
    expect(Number(gap)).toBe(1);
    const last = (await history("deepseek-input")).at(-1)!;
    expect([last.costPerUnitInUsdCents, last.priceSource]).toEqual(["0.0001200000", "proposed-list"]);
    expect((await alignSeedVersionsToProposedList()).versionsWritten).toBe(0);
  });
});
