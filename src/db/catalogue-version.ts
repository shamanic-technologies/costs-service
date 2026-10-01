import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "./index.js";
import { platformCosts, providerCostVendorCosts, providersCosts } from "./schema.js";

export type CatalogueVersionRow = {
  pc: typeof providersCosts.$inferSelect;
  v: typeof providerCostVendorCosts.$inferSelect | null;
};

export type CatalogueVersionAt = { found: true; row: CatalogueVersionRow } | { found: false; reason: string };

/**
 * The version `/v1/platform-prices/:name` would have served at instant `at`, with its vendor cost:
 * the row existed then (created_at <= at) and was in force (effective_from <= at), on the plan the
 * provider was on at that instant — the exact unit price a consumer froze at that moment.
 * Not found = a reason naming what is missing, never a guess.
 */
export async function catalogueVersionAt(name: string, at: Date): Promise<CatalogueVersionAt> {
  const existedAndInForce = and(
    eq(providersCosts.name, name),
    lte(providersCosts.effectiveFrom, at),
    lte(providersCosts.createdAt, at),
  );

  const [newest] = await db
    .select({ provider: providersCosts.provider })
    .from(providersCosts)
    .where(existedAndInForce)
    .orderBy(desc(providersCosts.effectiveFrom), desc(providersCosts.createdAt))
    .limit(1);
  if (!newest) return { found: false, reason: `No price version of '${name}' was in force at ${at.toISOString()}` };

  const [plan] = await db
    .select()
    .from(platformCosts)
    .where(
      // effective_from only: the seed writes a new provider's plan row a moment AFTER that
      // provider's first cost rows, so bounding by created_at too would 404 the very instant
      // those rows came into existence.
      and(eq(platformCosts.provider, newest.provider), lte(platformCosts.effectiveFrom, at)),
    )
    .orderBy(desc(platformCosts.effectiveFrom))
    .limit(1);
  if (!plan) {
    return { found: false, reason: `No platform plan for provider '${newest.provider}' was in force at ${at.toISOString()}` };
  }

  const [row] = await db
    .select({ pc: providersCosts, v: providerCostVendorCosts })
    .from(providersCosts)
    .leftJoin(providerCostVendorCosts, eq(providerCostVendorCosts.providerCostId, providersCosts.id))
    .where(and(existedAndInForce, eq(providersCosts.planTier, plan.planTier), eq(providersCosts.billingCycle, plan.billingCycle)))
    .orderBy(desc(providersCosts.effectiveFrom), desc(providersCosts.createdAt))
    .limit(1);
  if (!row) {
    return {
      found: false,
      reason: `No price version of '${name}' on plan '${plan.planTier}/${plan.billingCycle}' was in force at ${at.toISOString()}`,
    };
  }
  return { found: true, row };
}
