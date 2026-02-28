import { Router } from "express";
import { eq, lte, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { providersCosts, platformPlans } from "../db/schema.js";

const router = Router();

/** Resolve the current platform plan for a provider. Returns null if none configured. */
async function getCurrentPlatformPlan(provider: string) {
  const now = new Date();
  const [plan] = await db
    .select()
    .from(platformPlans)
    .where(and(eq(platformPlans.provider, provider), lte(platformPlans.effectiveFrom, now)))
    .orderBy(desc(platformPlans.effectiveFrom))
    .limit(1);
  return plan ?? null;
}

// GET /v1/prices — list current platform prices for all cost names
router.get("/v1/prices", async (_req, res) => {
  try {
    const now = new Date();

    // 1. Get all current platform plans (latest per provider)
    const allPlans = await db
      .select()
      .from(platformPlans)
      .where(lte(platformPlans.effectiveFrom, now))
      .orderBy(platformPlans.provider, desc(platformPlans.effectiveFrom));

    const planMap = new Map<string, { planTier: string; billingCycle: string }>();
    for (const plan of allPlans) {
      if (!planMap.has(plan.provider)) {
        planMap.set(plan.provider, { planTier: plan.planTier, billingCycle: plan.billingCycle });
      }
    }

    // 2. Get all costs where effectiveFrom <= now
    const allCosts = await db
      .select()
      .from(providersCosts)
      .where(lte(providersCosts.effectiveFrom, now))
      .orderBy(providersCosts.name, desc(providersCosts.effectiveFrom));

    // 3. Filter by matching platform plan, deduplicate per name
    const seen = new Set<string>();
    const prices = allCosts
      .filter((row) => {
        if (seen.has(row.name)) return false;
        const plan = planMap.get(row.provider);
        if (!plan) return false;
        if (row.planTier !== plan.planTier || row.billingCycle !== plan.billingCycle) return false;
        seen.add(row.name);
        return true;
      })
      .map((row) => ({
        name: row.name,
        pricePerUnitInUsdCents: row.costPerUnitInUsdCents,
        provider: row.provider,
        effectiveFrom: row.effectiveFrom,
      }));

    res.json(prices);
  } catch (err) {
    console.error("[Costs Service] Error listing prices:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/prices/:name — current platform price for one cost name
router.get("/v1/prices/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const now = new Date();

    // 1. Find the provider for this cost name
    const [anyCost] = await db
      .select({ provider: providersCosts.provider })
      .from(providersCosts)
      .where(eq(providersCosts.name, name))
      .limit(1);

    if (!anyCost) {
      res.status(404).json({ error: "Price not found" });
      return;
    }

    // 2. Get current platform plan for this provider
    const plan = await getCurrentPlatformPlan(anyCost.provider);
    if (!plan) {
      res.status(500).json({ error: `No platform plan configured for provider '${anyCost.provider}'` });
      return;
    }

    // 3. Get the cost matching our plan
    const [result] = await db
      .select()
      .from(providersCosts)
      .where(
        and(
          eq(providersCosts.name, name),
          eq(providersCosts.planTier, plan.planTier),
          eq(providersCosts.billingCycle, plan.billingCycle),
          lte(providersCosts.effectiveFrom, now),
        ),
      )
      .orderBy(desc(providersCosts.effectiveFrom))
      .limit(1);

    if (!result) {
      res.status(404).json({
        error: `No price found for '${name}' on plan '${plan.planTier}/${plan.billingCycle}'`,
      });
      return;
    }

    res.json({
      name: result.name,
      pricePerUnitInUsdCents: result.costPerUnitInUsdCents,
      provider: result.provider,
      effectiveFrom: result.effectiveFrom,
    });
  } catch (err) {
    console.error("[Costs Service] Error getting price:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
