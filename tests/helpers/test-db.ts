import { db, sql } from "../../src/db/index.js";
import { providersCosts, platformCosts } from "../../src/db/schema.js";

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
