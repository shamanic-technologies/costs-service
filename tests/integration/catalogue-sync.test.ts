import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { and, asc, eq } from "drizzle-orm";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertPlatformCost, insertTestProviderCost } from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import {
  catalogueSyncs,
  emailSendPriceRefreshes,
  providerCostVendorCosts,
  providersCosts,
  realCostRefreshes,
  realUnitCostsDaily,
  subscriptionCostRefreshes,
} from "../../src/db/schema.js";
import { StaleProposedListError, syncCatalogueToProposed } from "../../src/db/catalogue-sync.js";
import { recordVendorCosts } from "../../src/db/vendor-costs.js";
import { seedProvidersCosts, SEED_PROVIDERS_COSTS } from "../../src/db/seed.js";
import { utcDay } from "../../src/db/email-send-price.js";

// Owner go 2026-10-02: the proposed price list IS the billed catalogue price, kept in sync after
// every refresh, append-only (never retroactive), and failing loud on a stale list.
const API_KEY = { "x-api-key": "test-api-key" };
const T0 = new Date("2025-01-01T00:00:00Z");

async function clean() {
  for (const t of [catalogueSyncs, realUnitCostsDaily, realCostRefreshes, emailSendPriceRefreshes, subscriptionCostRefreshes, providerCostVendorCosts]) await db.delete(t);
  await cleanTestData();
}

async function catalogue() {
  for (const [name, provider, price, vendor, basis] of [
    ["anthropic-sonnet-5.5-tokens-input", "anthropic", "0.0010000000", "0.0002000000", "marked-up"],
    ["stripe-processing-fee", "stripe", "1.0000000000", "1.0000000000", "pass-through"],
    ["instantly-account-email-sent", "instantly", null, null, "marked-up"],
    ["apollo-credit", "apollo", "11.8000000000", "2.3600000000", "marked-up"],
  ] as const) {
    await insertPlatformCost({ provider, planTier: "p", billingCycle: "monthly", effectiveFrom: T0 });
    const [row] = await db
      .insert(providersCosts)
      .values({ name, provider, planTier: "p", billingCycle: "monthly", type: "t", unit: "u", costPerUnitInUsdCents: price, pricingBasis: basis, effectiveFrom: T0 })
      .returning();
    await db.insert(providerCostVendorCosts).values({
      providerCostId: row.id,
      vendorCostPerUnitInUsdCents: vendor,
      markupMultiplier: vendor ? "5.0000" : null,
      derivation: vendor ? "seed-vendor-rate" : "unknown",
      unknownReason: vendor ? null : "no-billable-price",
    });
  }
}

/** Today's proposed list as a refresh stores it, from sibling refreshes as of `siblingsAsOf`. */
async function proposedList(opts: { asOf?: string; siblingsAsOf?: string; status?: string } = {}) {
  const today = utcDay(new Date());
  const [email] = await db.insert(emailSendPriceRefreshes).values({ asOf: opts.siblingsAsOf ?? today, status: "succeeded", finishedAt: new Date() }).returning();
  const [subs] = await db.insert(subscriptionCostRefreshes).values({ asOf: opts.siblingsAsOf ?? today, status: "succeeded", finishedAt: new Date() }).returning();
  const [refresh] = await db
    .insert(realCostRefreshes)
    .values({ asOf: opts.asOf ?? today, status: opts.status ?? "succeeded", finishedAt: new Date(), emailSendPriceRefreshId: email.id, subscriptionCostRefreshId: subs.id })
    .returning();
  const g = (costName: string, provider: string, method: string, proposed: string | null, real: string | null, basis = "real-cost-x2") => ({
    day: today,
    costName,
    provider,
    method,
    multiplier: "2.00",
    proposedBasis: basis,
    proposedPriceUsdCents: proposed,
    realCostUsdCents: real,
    refreshId: refresh.id,
  });
  await db.insert(realUnitCostsDaily).values([
    g("anthropic-sonnet-5.5-tokens-input", "anthropic", "api-list-cost", "0.0004000000", "0.0002000000"),
    g("stripe-processing-fee", "stripe", "pass-through", "1.0000000000", "1.0000000000", "real-cost-x1"),
    g("instantly-account-email-sent", "instantly", "email-send-price", "3.0519000000", "1.5259500000"),
    g("apollo-credit", "apollo", "subscription", "5.7178980000", "2.8589490000"),
    g("apollo-enrichment-credit", "apollo", "subscription", "5.7178980000", "2.8589490000"),
  ]);
  return refresh;
}

describe("catalogue sync: the proposed list is the billed price", { timeout: 30_000 }, () => {
  const app = createTestApp();
  const headers = getIdentityHeaders();
  const price = async (name: string) => (await request(app).get(`/v1/platform-prices/${name}`).set(headers)).body;

  beforeEach(clean);
  afterAll(clean);

  it("bills every item at today's proposed price from now on, keeping every past version", async () => {
    await catalogue();
    await proposedList();
    const before = new Date();
    const outcome = await syncCatalogueToProposed();
    // Stripe already at x1: unchanged. The other four switch, one of them a name the catalogue never carried.
    expect(outcome).toMatchObject({ versionsWritten: 4, unchanged: 1, kept: [] });

    expect(await price("anthropic-sonnet-5.5-tokens-input")).toMatchObject({ pricePerUnitInUsdCents: "0.0004000000", pricingBasis: "marked-up" });
    expect(await price("apollo-credit")).toMatchObject({ pricePerUnitInUsdCents: "5.7178980000" });
    expect(await price("stripe-processing-fee")).toMatchObject({ pricePerUnitInUsdCents: "1.0000000000", pricingBasis: "pass-through" });
    // The delisted email line is billable again, before instantly-service declares it.
    expect(await price("instantly-account-email-sent")).toMatchObject({ pricePerUnitInUsdCents: "3.0519000000", billable: true });
    expect(await price("apollo-enrichment-credit")).toMatchObject({ pricePerUnitInUsdCents: "5.7178980000", provider: "apollo" });
    const listed = (await request(app).get("/v1/platform-prices").set(headers)).body.map((p: { name: string }) => p.name);
    expect(listed).toContain("instantly-account-email-sent");

    // Never retroactive: the old version stays in force up to the switch instant.
    const history = await db.select().from(providersCosts).where(eq(providersCosts.name, "apollo-credit")).orderBy(asc(providersCosts.effectiveFrom));
    expect(history.map((h) => [h.costPerUnitInUsdCents, h.priceSource])).toEqual([
      ["11.8000000000", "seed"],
      ["5.7178980000", "proposed-list"],
    ]);
    expect(history[1].effectiveFrom.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    // Every new version is stated in the vendor-cost table (runs-service's margin read), vendor rate carried.
    const [vc] = await db.select().from(providerCostVendorCosts).where(eq(providerCostVendorCosts.providerCostId, history[1].id));
    expect(vc).toMatchObject({ vendorCostPerUnitInUsdCents: "2.3600000000", derivation: "proposed-list" });
    const vendorCosts = await request(app).get("/internal/vendor-costs/apollo-credit").set(API_KEY);
    expect(vendorCosts.status).toBe(200);

    // Idempotent: a second sync of the same list writes nothing.
    expect((await syncCatalogueToProposed()).versionsWritten).toBe(0);
    const syncs = await request(app).get("/internal/catalogue-syncs").set(API_KEY);
    expect(syncs.body.syncs.map((s: { status: string }) => s.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("the boot seed and vendor-cost restatement never revert a synced price", async () => {
    // A name the real seed carries, pre-seeded exactly as the seed writes it.
    const seeded = SEED_PROVIDERS_COSTS.find((c) => c.name === "anthropic-sonnet-5.5-tokens-input")!;
    await insertPlatformCost({ provider: seeded.provider, planTier: seeded.planTier, billingCycle: seeded.billingCycle, effectiveFrom: T0 });
    await seedProvidersCosts();
    await recordVendorCosts();
    const [seedRow] = await db.select().from(providersCosts).where(eq(providersCosts.name, seeded.name));
    const today = utcDay(new Date());
    const [email] = await db.insert(emailSendPriceRefreshes).values({ asOf: today, status: "succeeded", finishedAt: new Date() }).returning();
    const [subs] = await db.insert(subscriptionCostRefreshes).values({ asOf: today, status: "succeeded", finishedAt: new Date() }).returning();
    const [refresh] = await db.insert(realCostRefreshes).values({ asOf: today, status: "succeeded", finishedAt: new Date(), emailSendPriceRefreshId: email.id, subscriptionCostRefreshId: subs.id }).returning();
    await db.insert(realUnitCostsDaily).values({ day: today, costName: seeded.name, provider: seeded.provider, method: "api-list-cost", multiplier: "2.00", proposedBasis: "real-cost-x2", proposedPriceUsdCents: "0.0004000000", realCostUsdCents: "0.0002000000", refreshId: refresh.id });
    await syncCatalogueToProposed();

    await seedProvidersCosts();
    await recordVendorCosts();
    const rows = await db.select().from(providersCosts).where(eq(providersCosts.name, seeded.name)).orderBy(asc(providersCosts.effectiveFrom));
    expect(rows.map((r) => [r.costPerUnitInUsdCents, r.priceSource])).toEqual([
      [seedRow.costPerUnitInUsdCents, "seed"],
      ["0.0004000000", "proposed-list"],
    ]);
    expect(await price(seeded.name)).toMatchObject({ pricePerUnitInUsdCents: "0.0004000000" });
    const [vc] = await db.select().from(providerCostVendorCosts).where(eq(providerCostVendorCosts.providerCostId, rows[1].id));
    expect(vc.derivation).toBe("proposed-list");
  });

  it("fails loud and writes no price when the proposed list is stale or its refresh failed", async () => {
    await catalogue();
    const yesterday = utcDay(new Date(Date.now() - 86_400_000));
    const cases: [Parameters<typeof proposedList>[0], RegExp][] = [
      [{ asOf: yesterday }, /not today/],
      [{ siblingsAsOf: yesterday }, /email send price as of/],
      [{ status: "failed" }, /last real-cost refresh is 'failed'/],
    ];
    for (const [opts, message] of cases) {
      await db.delete(realUnitCostsDaily);
      await db.delete(realCostRefreshes);
      await proposedList(opts);
      await expect(syncCatalogueToProposed()).rejects.toThrow(StaleProposedListError);
      await expect(syncCatalogueToProposed()).rejects.toThrow(message);
    }
    expect(await price("apollo-credit")).toMatchObject({ pricePerUnitInUsdCents: "11.8000000000" });
    expect(await db.select().from(providersCosts).where(and(eq(providersCosts.priceSource, "proposed-list")))).toEqual([]);
    const failed = await db.select().from(catalogueSyncs);
    expect(failed.every((s) => s.status === "failed" && s.versionsWritten === 0 && s.error)).toBe(true);
  });

  it("refuses to bill a production item at 0 and keeps the last good catalogue", async () => {
    await catalogue();
    await proposedList();
    await db.update(realUnitCostsDaily).set({ proposedPriceUsdCents: "0.0000000000" }).where(eq(realUnitCostsDaily.costName, "anthropic-sonnet-5.5-tokens-input"));
    await expect(syncCatalogueToProposed()).rejects.toThrow(/only a unit declared included at the vendor may be billed 0/);
    expect(await price("anthropic-sonnet-5.5-tokens-input")).toMatchObject({ pricePerUnitInUsdCents: "0.0010000000" });
    expect(await db.select().from(providersCosts).where(eq(providersCosts.priceSource, "proposed-list"))).toEqual([]);
  });

  it("insertTestProviderCost rows read as seed versions", async () => {
    const row = await insertTestProviderCost({ name: "x", provider: "y", planTier: "p", billingCycle: "monthly", costPerUnitInUsdCents: "1.0000000000" });
    expect(row.priceSource).toBe("seed");
  });
});
