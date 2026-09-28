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

// chat-service dropped the Vercel AI Gateway in v0.51.0. The catalog retires the `vercel`
// provider by no longer DECLARING it — the seed is append-only and never deletes, so the
// production rows it left behind stay put:
//   - one `vercel` platform_costs row
//   - four gateway-priced `deepseek-v4-*-tokens-{input,output}` rows dated 2025-01-01,
//     superseded by newer vendor-priced rows carrying provider `deepseek`.
// Those rows are what makes spend already declared under those names readable at the price
// it was written with, so they must survive; nothing live may resolve them.
describe("Vercel AI Gateway retirement", { timeout: 30_000 }, () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  const GATEWAY_ROWS = [
    { name: "deepseek-v4-flash-tokens-input", cost: "0.0001760000" },
    { name: "deepseek-v4-flash-tokens-output", cost: "0.0005280000" },
    { name: "deepseek-v4-pro-tokens-input", cost: "0.0006960000" },
    { name: "deepseek-v4-pro-tokens-output", cost: "0.0013920000" },
  ];

  const VENDOR_PRICES: Record<string, string> = {
    "deepseek-v4-flash-tokens-input": "0.0000700000",
    "deepseek-v4-flash-tokens-output": "0.0001400000",
    "deepseek-v4-pro-tokens-input": "0.0002175000",
    "deepseek-v4-pro-tokens-output": "0.0004350000",
  };

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  /** Production's leftovers: gateway-priced rows on provider `vercel`, plus its plan row. */
  async function seedRetiredGatewayLeftovers({ withPlatformRow }: { withPlatformRow: boolean }) {
    for (const row of GATEWAY_ROWS) {
      await insertTestProviderCost({
        name: row.name,
        provider: "vercel",
        providerDomain: "vercel.com",
        type: "Tokens (via Vercel AI Gateway)",
        unit: "1M tokens",
        planTier: "pay-as-you-go",
        billingCycle: "monthly",
        costPerUnitInUsdCents: row.cost,
        effectiveFrom: new Date("2025-01-01T00:00:00Z"),
      });
    }
    if (withPlatformRow) {
      await insertPlatformCost({
        provider: "vercel",
        planTier: "pay-as-you-go",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01T00:00:00Z"),
      });
    }
  }

  it("no longer seeds a vercel platform plan row", async () => {
    await seedProvidersCosts();
    await seedPlatformCosts();

    const rows = await db.select().from(platformCosts).where(eq(platformCosts.provider, "vercel"));
    expect(rows).toHaveLength(0);
  });

  it("leaves the production vercel plan row untouched — retirement is not a delete", async () => {
    await seedRetiredGatewayLeftovers({ withPlatformRow: true });
    await seedProvidersCosts();
    await seedPlatformCosts();

    const rows = await db.select().from(platformCosts).where(eq(platformCosts.provider, "vercel"));
    expect(rows).toHaveLength(1);
    expect(rows[0].planTier).toBe("pay-as-you-go");
  });

  it("keeps every gateway-priced row readable at the price it was written with", async () => {
    await seedRetiredGatewayLeftovers({ withPlatformRow: true });
    await seedProvidersCosts();

    for (const row of GATEWAY_ROWS) {
      const versions = await db
        .select()
        .from(providersCosts)
        .where(
          and(
            eq(providersCosts.name, row.name),
            eq(providersCosts.planTier, "pay-as-you-go"),
            eq(providersCosts.billingCycle, "monthly"),
          ),
        )
        .orderBy(desc(providersCosts.effectiveFrom));

      // Two versions: the vendor-priced one in force, the gateway one still queryable.
      expect(versions.length, row.name).toBe(2);
      expect(versions[1].provider, row.name).toBe("vercel");
      expect(versions[1].costPerUnitInUsdCents, row.name).toBe(row.cost);
    }
  });

  // The regression: `/v1/platform-prices/:name` and `/v1/providers-costs/:name` used to read a
  // name's provider from an UNORDERED `limit(1)`, so they could pick the superseded `vercel`
  // row. With the plan row retired that resolves to a 500 ("No platform cost configured for
  // provider 'vercel'") on a name that is perfectly priced at the vendor.
  it("resolves a retired provider's name from its newest in-force row, not a superseded one", async () => {
    await seedRetiredGatewayLeftovers({ withPlatformRow: false });
    await seedProvidersCosts();
    await seedPlatformCosts();

    for (const [name, price] of Object.entries(VENDOR_PRICES)) {
      const priceRes = await request(app).get(`/v1/platform-prices/${name}`).set(identityHeaders);
      expect(priceRes.status, `${name} must resolve`).toBe(200);
      expect(priceRes.body.pricePerUnitInUsdCents, name).toBe(price);
      expect(priceRes.body.provider, name).toBe("deepseek");

      const costRes = await request(app).get(`/v1/providers-costs/${name}`).set(identityHeaders);
      expect(costRes.status, `${name} must resolve`).toBe(200);
      expect(costRes.body.provider, name).toBe("deepseek");
    }
  });

  it("serves no vercel-priced row from the list endpoint", async () => {
    await seedRetiredGatewayLeftovers({ withPlatformRow: true });
    await seedProvidersCosts();
    await seedPlatformCosts();

    const res = await request(app).get("/v1/platform-prices").set(identityHeaders);
    expect(res.status).toBe(200);
    expect(res.body.some((p: { provider: string }) => p.provider === "vercel")).toBe(false);

    for (const [name, price] of Object.entries(VENDOR_PRICES)) {
      const served = res.body.find((p: { name: string }) => p.name === name);
      expect(served, name).toBeDefined();
      expect(served.pricePerUnitInUsdCents, name).toBe(price);
    }
  });

  it("is idempotent against the production shape (gateway leftovers + retired plan row)", async () => {
    await seedRetiredGatewayLeftovers({ withPlatformRow: true });
    await seedProvidersCosts();
    await seedPlatformCosts();
    const costs1 = await db.select().from(providersCosts);
    const plans1 = await db.select().from(platformCosts);

    await seedProvidersCosts();
    await seedPlatformCosts();
    const costs2 = await db.select().from(providersCosts);
    const plans2 = await db.select().from(platformCosts);

    expect(costs2.length).toBe(costs1.length);
    expect(plans2.length).toBe(plans1.length);
  });

  it("serves the six Moonshot Kimi names at the vendor basis after boot", async () => {
    await seedProvidersCosts();
    await seedPlatformCosts();

    const expected: Record<string, string> = {
      "moonshot-kimi-k2.6-tokens-input": "0.0004750000", // $0.95/MTok × 5
      "moonshot-kimi-k2.6-tokens-cached-input": "0.0000800000", // $0.16/MTok × 5
      "moonshot-kimi-k2.6-tokens-output": "0.0020000000", // $4.00/MTok × 5
      "moonshot-kimi-k3-tokens-input": "0.0015000000", // $3.00/MTok × 5
      "moonshot-kimi-k3-tokens-cached-input": "0.0001500000", // $0.30/MTok × 5
      "moonshot-kimi-k3-tokens-output": "0.0075000000", // $15.00/MTok × 5
    };

    for (const [name, price] of Object.entries(expected)) {
      const res = await request(app).get(`/v1/platform-prices/${name}`).set(identityHeaders);
      expect(res.status, `${name} must resolve`).toBe(200);
      expect(res.body.pricePerUnitInUsdCents, name).toBe(price);
      expect(res.body.provider, name).toBe("moonshot");
      expect(res.body.providerDomain, name).toBe("moonshot.ai");
      expect(res.body.pricingRegime, name).toBeNull();
    }
  });
});
