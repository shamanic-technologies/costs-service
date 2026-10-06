import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getIdentityHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestProviderCost, insertPlatformCost, closeDb } from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { consumptionByOrgDaily, realCostRefreshes } from "../../src/db/schema.js";

describe("Platform Prices (consumer-facing)", () => {
  const app = createTestApp();
  const identityHeaders = getIdentityHeaders();

  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /v1/platform-prices/:name", () => {
    it("returns the price resolved via platform cost config", async () => {
      await insertTestProviderCost({
        name: "test-token-input",
        provider: "test-provider",
        providerDomain: "test.example",
        type: "Input tokens",
        unit: "1M tokens",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.0003",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertPlatformCost({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices/test-token-input").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("test-token-input");
      expect(res.body.pricePerUnitInUsdCents).toBe("0.0003000000");
      expect(res.body.provider).toBe("test-provider");
      expect(res.body.providerDomain).toBe("test.example");
      expect(res.body.type).toBe("Input tokens");
      expect(res.body.unit).toBe("1M tokens");
      expect(res.body.effectiveFrom).toBeDefined();
      // Should NOT expose plan details
      expect(res.body.planTier).toBeUndefined();
      expect(res.body.billingCycle).toBeUndefined();
      expect(res.body.id).toBeUndefined();
    });

    it("returns 404 for unknown name", async () => {
      const res = await request(app).get("/v1/platform-prices/nonexistent").set(identityHeaders);
      expect(res.status).toBe(404);
    });

    it("returns 500 when no platform cost exists for provider", async () => {
      await insertTestProviderCost({
        name: "orphan",
        provider: "no-plan-provider",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices/orphan").set(identityHeaders);
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("No platform cost configured");
    });

    it("returns 404 when cost exists but not for the active plan", async () => {
      await insertTestProviderCost({
        name: "wrong_plan",
        provider: "test-provider",
        planTier: "enterprise",
        billingCycle: "annual",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertPlatformCost({
        provider: "test-provider",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices/wrong_plan").set(identityHeaders);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("basic/monthly");
    });
  });

  describe("GET /v1/platform-prices", () => {
    it("returns current prices for all cost names", async () => {
      await insertPlatformCost({
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertPlatformCost({
        provider: "provider-b",
        planTier: "growth",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertTestProviderCost({
        name: "alpha",
        provider: "provider-a",
        providerDomain: "a.example",
        type: "Lead enrichment",
        unit: "lead",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "beta",
        provider: "provider-b",
        providerDomain: "b.example",
        type: "Email send",
        unit: "email",
        planTier: "growth",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "1.00",
        effectiveFrom: new Date("2025-03-01"),
      });

      const res = await request(app).get("/v1/platform-prices").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const alpha = res.body.find((p: any) => p.name === "alpha");
      const beta = res.body.find((p: any) => p.name === "beta");
      expect(alpha.pricePerUnitInUsdCents).toBe("0.0100000000");
      expect(alpha.providerDomain).toBe("a.example");
      expect(alpha.type).toBe("Lead enrichment");
      expect(alpha.unit).toBe("lead");
      expect(beta.pricePerUnitInUsdCents).toBe("1.0000000000");
      expect(beta.providerDomain).toBe("b.example");
      expect(beta.type).toBe("Email send");
      expect(beta.unit).toBe("email");
      // Should NOT expose plan details
      expect(alpha.planTier).toBeUndefined();
      expect(alpha.billingCycle).toBeUndefined();
    });

    it("excludes costs whose provider has no platform cost config", async () => {
      await insertPlatformCost({
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });

      await insertTestProviderCost({
        name: "alpha",
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "orphan",
        provider: "no-plan",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.99",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices").set(identityHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("alpha");
    });

    it("is publicly accessible without identity headers (consumer-facing)", async () => {
      await insertPlatformCost({
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        effectiveFrom: new Date("2025-01-01"),
      });
      await insertTestProviderCost({
        name: "alpha",
        provider: "provider-a",
        planTier: "basic",
        billingCycle: "monthly",
        costPerUnitInUsdCents: "0.01",
        effectiveFrom: new Date("2025-01-01"),
      });

      const res = await request(app).get("/v1/platform-prices");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("alpha");
    });
  });

  describe("status: current vs retired (daegu-v2 report 2026-10-06)", () => {
    it("serves a retired name with its successors and a current name as current, in the list and by name", async () => {
      await insertPlatformCost({ provider: "instantly", planTier: "basic", billingCycle: "monthly", effectiveFrom: new Date("2025-01-01") });
      for (const name of ["instantly-email-send", "instantly-account-email-sent"]) {
        await insertTestProviderCost({
          name,
          provider: "instantly",
          providerDomain: "instantly.ai",
          type: "Email send",
          unit: "email",
          planTier: "basic",
          billingCycle: "monthly",
          costPerUnitInUsdCents: "2.9886",
          effectiveFrom: new Date("2025-01-01"),
        });
      }

      const list = await request(app).get("/v1/platform-prices").set(identityHeaders);
      expect(list.status).toBe(200);
      const byName = Object.fromEntries(list.body.map((p: { name: string }) => [p.name, p]));
      expect(byName["instantly-email-send"].status).toBe("retired");
      expect(byName["instantly-email-send"].supersededBy).toEqual(["instantly-account-email-sent", "instantly-domain-email-sent"]);
      expect(byName["instantly-account-email-sent"].status).toBe("current");
      expect(byName["instantly-account-email-sent"].supersededBy).toBeNull();

      const one = await request(app).get("/v1/platform-prices/instantly-email-send").set(identityHeaders);
      expect(one.status).toBe(200);
      expect(one.body.status).toBe("retired");
      // Still priced: spend already declared against it keeps resolving.
      expect(one.body.pricePerUnitInUsdCents).toBe("2.9886000000");
    });
  });

  describe("lastUsedOn + bundle on the list (daegu-v2 asks 2026-10-06)", () => {
    beforeEach(async () => {
      await db.delete(consumptionByOrgDaily);
      await db.delete(realCostRefreshes);
    });

    it("serves last use per name from runs consumption, and the price of one email on both email rows", async () => {
      await insertPlatformCost({ provider: "instantly", planTier: "basic", billingCycle: "monthly", effectiveFrom: new Date("2025-01-01") });
      for (const name of ["instantly-account-email-sent", "instantly-domain-email-sent"]) {
        await insertTestProviderCost({
          name, provider: "instantly", providerDomain: "instantly.ai", type: "Email send", unit: "email",
          planTier: "basic", billingCycle: "monthly", costPerUnitInUsdCents: "2.9886", effectiveFrom: new Date("2025-01-01"),
        });
      }
      const row = (day: string, quantity: string) => ({
        day, orgId: "org-1", costName: "instantly-account-email-sent", costSource: "platform", quantity, billedUsdCents: "0", netBilledUsdCents: "0",
      });
      // A later day with zero units is not a use.
      await db.insert(consumptionByOrgDaily).values([row("2026-09-01", "3"), row("2026-09-20", "1"), row("2026-09-25", "0")]);
      const finishedAt = new Date("2026-10-06T06:00:00Z");
      await db.insert(realCostRefreshes).values([
        { asOf: "2026-10-06", status: "succeeded", finishedAt },
        { asOf: "2026-10-07", status: "failed", finishedAt: new Date("2026-10-07T06:00:00Z") },
      ]);

      const res = await request(app).get("/v1/platform-prices").set(identityHeaders);
      expect(res.status).toBe(200);
      const byName = Object.fromEntries(res.body.map((p: { name: string }) => [p.name, p]));
      expect(byName["instantly-account-email-sent"].lastUsedOn).toBe("2026-09-20");
      expect(byName["instantly-domain-email-sent"].lastUsedOn).toBeNull();
      expect(byName["instantly-account-email-sent"].usageReadAt).toBe(finishedAt.toISOString());
      for (const n of ["instantly-account-email-sent", "instantly-domain-email-sent"]) {
        expect(byName[n].bundle).toEqual({
          name: "email-sent", unit: "email",
          members: ["instantly-account-email-sent", "instantly-domain-email-sent"],
          pricePerUnitInUsdCents: "5.9772000000",
        });
      }
    });
  });
});
