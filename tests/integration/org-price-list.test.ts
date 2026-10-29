import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, closeDb, insertPlatformCost } from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { orgPriceLists, providersCosts } from "../../src/db/schema.js";
import { STANDARD_PRICE_LIST_FROM } from "../../src/lib/price-lists.js";

// PRICE-X1-1029 (owner 2026-10-29): an org created from the ship pays the vendor list price (x1),
// an org created before keeps x2. Worked example: a $0.010 email is billed $0.010 to the new org,
// $0.020 to the existing one, and the public catalogue shows $0.010.
const T0 = new Date("2025-01-01T00:00:00Z");
const KEY = { "x-api-key": "test-api-key" };
const NEW_ORG = "11111111-1111-4111-8111-111111111111";
const OLD_ORG = "22222222-2222-4222-8222-222222222222";

function clientServiceAnswers(orgs: { orgId: string; createdAt: string }[] | Error) {
  const fetchMock = vi.fn(async (url: string) => {
    if (orgs instanceof Error) throw orgs;
    expect(url).toContain(`/internal/acquisitions?createdAfter=${encodeURIComponent(STANDARD_PRICE_LIST_FROM.toISOString())}`);
    return new Response(JSON.stringify({ orgs: orgs.map((o) => ({ ...o, name: null, anonymous: false, claimedAt: null, real: true, acquisition: null })) }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("the price an org pays: x1 for new accounts, x2 grandfathered (PRICE-X1-1029)", () => {
  const app = createTestApp();

  beforeEach(async () => {
    process.env.CLIENT_SERVICE_URL = "http://client-service.test";
    process.env.CLIENT_SERVICE_API_KEY = "client-key";
    await db.delete(orgPriceLists);
    await cleanTestData();
    await insertPlatformCost({ provider: "instantly", planTier: "p", billingCycle: "monthly", effectiveFrom: T0 });
    await db.insert(providersCosts).values({
      name: "instantly-account-email-sent",
      provider: "instantly",
      planTier: "p",
      billingCycle: "monthly",
      type: "Email sent",
      unit: "email",
      costPerUnitInUsdCents: "2.0000000000",
      standardPricePerUnitInUsdCents: "1.0000000000",
      pricingBasis: "marked-up",
      priceSource: "proposed-list",
      effectiveFrom: T0,
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await db.delete(orgPriceLists);
    await cleanTestData();
    await closeDb();
  });

  it("an org created after the ship pays x1; an org created before pays x2", async () => {
    const fetchMock = clientServiceAnswers([{ orgId: NEW_ORG, createdAt: new Date(STANDARD_PRICE_LIST_FROM.getTime() + 3_600_000).toISOString() }]);
    const asNew = await request(app).get("/v1/platform-prices/instantly-account-email-sent").set({ ...KEY, "x-org-id": NEW_ORG });
    expect(asNew.status).toBe(200);
    expect(asNew.body).toMatchObject({ pricePerUnitInUsdCents: "1.0000000000", priceList: "standard", billable: true });

    const asOld = await request(app).get("/v1/platform-prices/instantly-account-email-sent").set({ ...KEY, "x-org-id": OLD_ORG });
    expect(asOld.body).toMatchObject({ pricePerUnitInUsdCents: "2.0000000000", priceList: "grandfathered" });

    // Decided once and persisted: a later read asks client-service nothing.
    const rows = await db.select().from(orgPriceLists);
    expect(rows.map((r) => [r.orgId, r.priceList]).sort()).toEqual([
      [NEW_ORG, "standard"],
      [OLD_ORG, "grandfathered"],
    ]);
    fetchMock.mockClear();
    await request(app).get("/v1/platform-prices/instantly-account-email-sent").set({ ...KEY, "x-org-id": NEW_ORG });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the public read (by name and the listing) serves x1", async () => {
    const fetchMock = clientServiceAnswers([]);
    expect((await request(app).get("/v1/platform-prices/instantly-account-email-sent")).body).toMatchObject({ pricePerUnitInUsdCents: "1.0000000000", priceList: "standard" });
    const listed = (await request(app).get("/v1/platform-prices")).body as { name: string; pricePerUnitInUsdCents: string; priceList: string }[];
    expect(listed.find((p) => p.name === "instantly-account-email-sent")).toMatchObject({ pricePerUnitInUsdCents: "1.0000000000", priceList: "standard" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never answers an org's price to an unauthenticated caller, nor for a non-uuid org", async () => {
    clientServiceAnswers([]);
    expect((await request(app).get("/v1/platform-prices/instantly-account-email-sent").set({ "x-org-id": OLD_ORG })).status).toBe(401);
    expect((await request(app).get("/v1/platform-prices/instantly-account-email-sent").set({ "x-api-key": "wrong", "x-org-id": OLD_ORG })).status).toBe(401);
    expect((await request(app).get("/v1/platform-prices/instantly-account-email-sent").set({ ...KEY, "x-org-id": "org_abc" })).status).toBe(400);
  });

  it("client-service unreachable = 502, no price guessed and nothing decided", async () => {
    clientServiceAnswers(new TypeError("fetch failed"));
    const res = await request(app).get("/v1/platform-prices/instantly-account-email-sent").set({ ...KEY, "x-org-id": NEW_ORG });
    expect(res.status).toBe(502);
    expect(await db.select().from(orgPriceLists).where(eq(orgPriceLists.orgId, NEW_ORG))).toEqual([]);
  });
});
