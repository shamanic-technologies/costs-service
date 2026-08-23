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
import { providersCosts } from "../../src/db/schema.js";

// chat-service is dropping the Vercel AI Gateway and calling DeepSeek and Z.ai directly.
// The gateway priced DeepSeek 3.1x (Flash) and 4x (Pro) above the vendor's own list price,
// so those two names must reprice onto the vendor basis, and the four Z.ai names must
// resolve for the first time. This test reproduces the PRODUCTION row shape (gateway price,
// provider `vercel`) and asserts the reprice appends rather than overwrites.
describe("Direct-vendor model prices", { timeout: 30_000 }, () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  async function seedProdShapedGatewayRows() {
    // Exactly what production carries today: gateway basis, provider `vercel`.
    const rows = [
      { name: "deepseek-v4-flash-tokens-input", cost: "0.0001760000" },
      { name: "deepseek-v4-flash-tokens-output", cost: "0.0005280000" },
      { name: "deepseek-v4-pro-tokens-input", cost: "0.0006960000" },
      { name: "deepseek-v4-pro-tokens-output", cost: "0.0013920000" },
    ];
    for (const row of rows) {
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
    await insertPlatformCost({
      provider: "vercel",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });
  }

  it("appends the vendor-basis DeepSeek price and keeps the gateway price as history", async () => {
    await seedProdShapedGatewayRows();
    await seedProvidersCosts();

    const rows = await db
      .select()
      .from(providersCosts)
      .where(
        and(
          eq(providersCosts.name, "deepseek-v4-flash-tokens-input"),
          eq(providersCosts.planTier, "pay-as-you-go"),
          eq(providersCosts.billingCycle, "monthly"),
        ),
      )
      .orderBy(desc(providersCosts.effectiveFrom));

    expect(rows.length).toBe(2);
    expect(rows[0].costPerUnitInUsdCents).toBe("0.0000700000"); // $0.14/MTok × 5
    expect(rows[0].provider).toBe("deepseek");
    expect(rows[1].costPerUnitInUsdCents).toBe("0.0001760000"); // gateway price, still queryable
    expect(rows[1].effectiveFrom.getTime()).toBeLessThan(rows[0].effectiveFrom.getTime());
  });

  it("serves all four DeepSeek names at the vendor basis, not the gateway basis", async () => {
    await seedProdShapedGatewayRows();
    await seedProvidersCosts();
    await seedPlatformCosts();

    const expected: Record<string, string> = {
      "deepseek-v4-flash-tokens-input": "0.0000700000",
      "deepseek-v4-flash-tokens-output": "0.0001400000",
      "deepseek-v4-pro-tokens-input": "0.0002175000",
      "deepseek-v4-pro-tokens-output": "0.0004350000",
    };

    for (const [name, price] of Object.entries(expected)) {
      const res = await request(app).get(`/v1/platform-prices/${name}`).set(identityHeaders);
      expect(res.status, `${name} must resolve`).toBe(200);
      expect(res.body.pricePerUnitInUsdCents, name).toBe(price);
    }
  });

  it("serves the Z.ai names after boot, GLM-5.3 alongside GLM-5.2", async () => {
    await seedProvidersCosts();
    await seedPlatformCosts();

    const expected: Record<string, string> = {
      "zai-glm-4.7-flashx-tokens-input": "0.0000350000",
      "zai-glm-4.7-flashx-tokens-output": "0.0002000000",
      "zai-glm-5.2-tokens-input": "0.0007000000",
      "zai-glm-5.2-tokens-output": "0.0022000000",
      // GLM-5.3 — same vendor list price as GLM-5.2, its own cost names.
      "zai-glm-5.3-tokens-input": "0.0007000000",
      "zai-glm-5.3-tokens-cached-input": "0.0001300000",
      "zai-glm-5.3-tokens-output": "0.0022000000",
    };

    for (const [name, price] of Object.entries(expected)) {
      const res = await request(app).get(`/v1/platform-prices/${name}`).set(identityHeaders);
      expect(res.status, `${name} must resolve`).toBe(200);
      expect(res.body.pricePerUnitInUsdCents, name).toBe(price);
      expect(res.body.provider).toBe("zai");
    }
  });

  it("is idempotent against a database already carrying the vendor basis", async () => {
    await seedProdShapedGatewayRows();
    await seedProvidersCosts();
    await seedPlatformCosts();
    const after1 = await db.select().from(providersCosts);

    await seedProvidersCosts();
    await seedPlatformCosts();
    const after2 = await db.select().from(providersCosts);

    expect(after2.length).toBe(after1.length);
  });
});
