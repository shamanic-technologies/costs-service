import { db, sql } from "../../src/db/index.js";
import { providersCosts, platformCosts } from "../../src/db/schema.js";
import type { PricingBasis } from "../../src/db/seed.js";

export async function cleanTestData() {
  await db.delete(providersCosts);
  await db.delete(platformCosts);
}

export async function insertTestProviderCost(data: {
  name: string;
  provider: string;
  planTier: string;
  billingCycle: string;
  costPerUnitInUsdCents: string;
  type?: string;
  unit?: string;
  providerDomain?: string | null;
  /** Defaults to the historical class: every row pre-dating pricing_basis was marked up. */
  pricingBasis?: PricingBasis;
  effectiveFrom?: Date;
}) {
  const [cost] = await db
    .insert(providersCosts)
    .values({
      name: data.name,
      provider: data.provider,
      planTier: data.planTier,
      billingCycle: data.billingCycle,
      costPerUnitInUsdCents: data.costPerUnitInUsdCents,
      type: data.type ?? "Test type",
      unit: data.unit ?? "test-unit",
      providerDomain: data.providerDomain ?? null,
      pricingBasis: data.pricingBasis ?? "marked-up",
      effectiveFrom: data.effectiveFrom || new Date(),
    })
    .returning();
  return cost;
}

export async function insertPlatformCost(data: {
  provider: string;
  planTier: string;
  billingCycle: string;
  effectiveFrom?: Date;
}) {
  const [cost] = await db
    .insert(platformCosts)
    .values({
      provider: data.provider,
      planTier: data.planTier,
      billingCycle: data.billingCycle,
      effectiveFrom: data.effectiveFrom || new Date(),
    })
    .returning();
  return cost;
}

export async function closeDb() {
  await sql.end();
}
