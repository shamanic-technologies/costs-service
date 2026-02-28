import { Router } from "express";
import { eq, lte, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { providersCosts, platformCosts } from "../db/schema.js";

const router = Router();

/** Resolve the current platform cost config for a provider. Returns null if none configured. */
async function getCurrentPlatformCost(provider: string) {
  const now = new Date();
  const [cost] = await db
    .select()
    .from(platformCosts)
    .where(and(eq(platformCosts.provider, provider), lte(platformCosts.effectiveFrom, now)))
    .orderBy(desc(platformCosts.effectiveFrom))
    .limit(1);
  return cost ?? null;
}

// GET /v1/platform-prices — list current platform prices for all cost names
router.get("/v1/platform-prices", async (_req, res) => {
  try {
    const now = new Date();

    // 1. Get all current platform costs (latest per provider)
    const allPlatformCosts = await db
      .select()
      .from(platformCosts)
      .where(lte(platformCosts.effectiveFrom, now))
      .orderBy(platformCosts.provider, desc(platformCosts.effectiveFrom));

    const planMap = new Map<string, { planTier: string; billingCycle: string }>();
    for (const pc of allPlatformCosts) {
      if (!planMap.has(pc.provider)) {
        planMap.set(pc.provider, { planTier: pc.planTier, billingCycle: pc.billingCycle });
      }
    }

    // 2. Get all costs where effectiveFrom <= now
    const allCosts = await db
      .select()
      .from(providersCosts)
      .where(lte(providersCosts.effectiveFrom, now))
      .orderBy(providersCosts.name, desc(providersCosts.effectiveFrom));

    // 3. Filter by matching platform cost config, deduplicate per name
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
    console.error("[Costs Service] Error listing platform prices:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/platform-prices/:name — current platform price for one cost name
router.get("/v1/platform-prices/:name", async (req, res) => {
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

    // 2. Get current platform cost config for this provider
    const platformCost = await getCurrentPlatformCost(anyCost.provider);
    if (!platformCost) {
      res.status(500).json({ error: `No platform cost configured for provider '${anyCost.provider}'` });
      return;
    }

    // 3. Get the cost matching our plan
    const [result] = await db
      .select()
      .from(providersCosts)
      .where(
        and(
          eq(providersCosts.name, name),
          eq(providersCosts.planTier, platformCost.planTier),
          eq(providersCosts.billingCycle, platformCost.billingCycle),
          lte(providersCosts.effectiveFrom, now),
        ),
      )
      .orderBy(desc(providersCosts.effectiveFrom))
      .limit(1);

    if (!result) {
      res.status(404).json({
        error: `No price found for '${name}' on plan '${platformCost.planTier}/${platformCost.billingCycle}'`,
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
    console.error("[Costs Service] Error getting platform price:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
