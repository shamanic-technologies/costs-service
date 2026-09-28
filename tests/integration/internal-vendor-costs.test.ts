import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createTestApp, getAuthHeaders, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertPlatformCost, insertTestProviderCost } from "../helpers/test-db.js";
import { seedProvidersCosts, seedPlatformCosts } from "../../src/db/seed.js";
import { recordVendorCosts } from "../../src/db/vendor-costs.js";
import { db } from "../../src/db/index.js";
import { providerCostVendorCosts, providersCosts } from "../../src/db/schema.js";

const API_KEY = { "x-api-key": "test-api-key" };

/** Every object key anywhere in a JSON value. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe("/internal/vendor-costs — vendor cost per price version, service-auth only", { timeout: 60_000 }, () => {
  const app = createTestApp();

  beforeEach(async () => {
    await cleanTestData();
    await seedProvidersCosts();
    await seedPlatformCosts();
  });

  afterAll(async () => {
    await cleanTestData();
  });

  it("refuses a caller without the service api key, on both reads", async () => {
    await recordVendorCosts();
    for (const path of ["/internal/vendor-costs", "/internal/vendor-costs/anthropic-haiku-4.5-tokens-input"]) {
      const anon = await request(app).get(path);
      expect(anon.status, path).toBe(401);
      expect(JSON.stringify(anon.body)).not.toMatch(/vendor|0\.0001/i);
      const withIdentityOnly = await request(app).get(path).set(getIdentityHeaders());
      expect(withIdentityOnly.status, path).toBe(401);
      const wrongKey = await request(app).get(path).set({ "x-api-key": "nope" });
      expect(wrongKey.status, path).toBe(401);
    }
  });

  it("leaves every public and identity-header read byte-identical, with no vendor field anywhere", async () => {
    const reads = [
      { path: "/v1/platform-prices", headers: {} },
      { path: "/v1/platform-prices/anthropic-haiku-4.5-tokens-input", headers: {} },
      { path: "/v1/platform-prices/google-ads-spend", headers: {} },
      { path: "/v1/providers-costs", headers: getIdentityHeaders() },
      { path: "/v1/providers-costs/anthropic-haiku-4.5-tokens-input", headers: getIdentityHeaders() },
      { path: "/v1/providers-costs/anthropic-haiku-4.5-tokens-input/history", headers: getIdentityHeaders() },
      { path: "/v1/providers-costs/anthropic-haiku-4.5-tokens-input/plans", headers: getIdentityHeaders() },
    ];
    const before = [];
    for (const r of reads) before.push((await request(app).get(r.path).set(r.headers)).text);

    await recordVendorCosts();

    for (const [i, r] of reads.entries()) {
      const res = await request(app).get(r.path).set(r.headers);
      expect(res.status, r.path).toBe(200);
      expect(res.text, r.path).toBe(before[i]);
      const keys = [...allKeys(res.body)].filter((k) => /vendor|markup|derivation/i.test(k));
      expect(keys, r.path).toEqual([]);
    }
  });

  it("states a vendor cost for every seeded version, and the vendor's list price on well-known lines", async () => {
    await recordVendorCosts();
    const res = await request(app).get("/internal/vendor-costs").set(API_KEY);
    expect(res.status).toBe(200);
    const versions: any[] = res.body.versions;
    expect(versions.length).toBe((await db.select().from(providersCosts)).length);

    const byName = (n: string) => versions.filter((v) => v.name === n).at(-1);
    expect(byName("anthropic-haiku-4.5-tokens-input")).toMatchObject({
      billedPricePerUnitInUsdCents: "0.0002500000",
      vendorCostPerUnitInUsdCents: "0.0001000000", // $1/MTok
      vendorCostKnown: true,
      markupMultiplier: "2.5000",
      vendorCostDerivation: "seed-vendor-rate",
      vendorCostUnknownReason: null,
    });
    expect(byName("google-flash-3-tokens-input").vendorCostPerUnitInUsdCents).toBe("0.0000500000"); // $0.50/MTok
    // DeepSeek V4.1 Flash peak input: $0.30/MTok × 1.06 non-recoverable VAT.
    expect(byName("deepseek-v4.1-flash-peak-tokens-input").vendorCostPerUnitInUsdCents).toBe("0.0000318000");
    expect(byName("google-ads-spend")).toMatchObject({ vendorCostPerUnitInUsdCents: "1.0000000000", markupMultiplier: "1.0000" });
    expect(byName("instantly-contact-uploaded")).toMatchObject({
      billedPricePerUnitInUsdCents: null,
      vendorCostPerUnitInUsdCents: null,
      vendorCostKnown: false,
      vendorCostUnknownReason: "no-billable-price",
    });

    // ?names= narrows the bulk read.
    const narrowed = await request(app)
      .get("/internal/vendor-costs?names=anthropic-haiku-4.5-tokens-input,google-ads-spend")
      .set(API_KEY);
    expect(new Set(narrowed.body.versions.map((v: any) => v.name))).toEqual(
      new Set(["anthropic-haiku-4.5-tokens-input", "google-ads-spend"]),
    );
  });

  it("resolves the version in force on a PAST date, at the markup it was written under", async () => {
    // A 6x-era row for Haiku, written and in force on 2026-09-01, superseded by a 5x-era row.
    const name = "anthropic-haiku-4.5-tokens-input";
    await db.delete(providersCosts).where(eq(providersCosts.name, name));
    const old = await insertTestProviderCost({
      name,
      provider: "anthropic",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "0.0006000000",
      effectiveFrom: new Date("2026-08-30T09:50:00Z"),
    });
    await db.update(providersCosts).set({ createdAt: new Date("2026-08-30T09:50:00Z") }).where(eq(providersCosts.id, old.id));
    const cur = await insertTestProviderCost({
      name,
      provider: "anthropic",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "0.0005000000",
      effectiveFrom: new Date("2026-09-15T09:00:00Z"),
    });
    await db.update(providersCosts).set({ createdAt: new Date("2026-09-15T09:00:00Z") }).where(eq(providersCosts.id, cur.id));
    await db.delete(providerCostVendorCosts);
    await recordVendorCosts();

    const past = await request(app).get(`/internal/vendor-costs/${name}?at=2026-09-01T00:00:00Z`).set(API_KEY);
    expect(past.status).toBe(200);
    expect(past.body.version).toMatchObject({
      id: old.id,
      billedPricePerUnitInUsdCents: "0.0006000000",
      vendorCostPerUnitInUsdCents: "0.0001000000",
      markupMultiplier: "6.0000",
    });

    const now = await request(app).get(`/internal/vendor-costs/${name}`).set(API_KEY);
    expect(now.body.version).toMatchObject({ id: cur.id, vendorCostPerUnitInUsdCents: "0.0001000000", markupMultiplier: "5.0000" });

    const before = await request(app).get(`/internal/vendor-costs/${name}?at=2026-01-01T00:00:00Z`).set(API_KEY);
    expect(before.status).toBe(404);

    const bad = await request(app).get(`/internal/vendor-costs/${name}?at=yesterday`).set(API_KEY);
    expect(bad.status).toBe(400);
  });

  it("states a version it cannot reproduce as unknown with a reason, never the billed price", async () => {
    const odd = await insertTestProviderCost({
      name: "anthropic-haiku-4.5-tokens-input",
      provider: "anthropic",
      planTier: "pay-as-you-go",
      billingCycle: "monthly",
      costPerUnitInUsdCents: "0.0004400000",
      effectiveFrom: new Date(Date.now() - 1000),
    });
    await recordVendorCosts();
    const res = await request(app).get("/internal/vendor-costs?names=anthropic-haiku-4.5-tokens-input").set(API_KEY);
    expect(res.body.versions.find((v: any) => v.id === odd.id)).toMatchObject({
      billedPricePerUnitInUsdCents: "0.0004400000",
      vendorCostPerUnitInUsdCents: null,
      vendorCostKnown: false,
      markupMultiplier: null,
      vendorCostDerivation: "unknown",
      vendorCostUnknownReason: "no-vendor-rate-on-record",
    });
  });

  it("is write-once and idempotent across boots", async () => {
    await recordVendorCosts();
    const first = await db.select().from(providerCostVendorCosts);
    await seedProvidersCosts();
    await recordVendorCosts();
    const second = await db.select().from(providerCostVendorCosts);
    expect(second.length).toBe(first.length);
    expect(second.map((r) => r.providerCostId).sort()).toEqual(first.map((r) => r.providerCostId).sort());
  });

  it("states the vendor cost of a price version written through PUT immediately", async () => {
    await insertPlatformCost({ provider: "anthropic", planTier: "pay-as-you-go", billingCycle: "monthly" }).catch(() => undefined);
    const put = await request(app)
      .put("/v1/providers-costs/anthropic-haiku-4.5-tokens-input")
      .set(getAuthHeaders())
      .send({
        costPerUnitInUsdCents: "0.0002500000",
        pricingBasis: "marked-up",
        provider: "anthropic",
        type: "Input tokens",
        unit: "1M tokens",
        planTier: "pay-as-you-go",
        billingCycle: "monthly",
      });
    expect(put.status).toBe(200);
    expect(Object.keys(put.body).filter((k) => /vendor|markup/i.test(k))).toEqual([]);
    const [vendorRow] = await db.select().from(providerCostVendorCosts).where(eq(providerCostVendorCosts.providerCostId, put.body.id));
    expect(vendorRow).toMatchObject({ vendorCostPerUnitInUsdCents: "0.0001000000", markupMultiplier: "2.5000" });
  });
});
