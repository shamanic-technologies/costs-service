import { Router } from "express";
import { eq, lte, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { providersCosts, platformPlans } from "../db/schema.js";
import { requireApiKey } from "../middleware/auth.js";
import { PutProviderCostBodySchema } from "../schemas.js";

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

// GET /v1/providers-costs — list all current provider costs (resolved via platform plan)
router.get("/v1/providers-costs", async (_req, res) => {
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
    const current = allCosts.filter((row) => {
      if (seen.has(row.name)) return false;
      const plan = planMap.get(row.provider);
      if (!plan) return false;
      if (row.planTier !== plan.planTier || row.billingCycle !== plan.billingCycle) return false;
      seen.add(row.name);
      return true;
    });

    res.json(current);
  } catch (err) {
    console.error("[Costs Service] Error listing providers costs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/providers-costs/:name — current provider cost for one name (resolved via platform plan)
router.get("/v1/providers-costs/:name", async (req, res) => {
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
      res.status(404).json({ error: "Provider cost not found" });
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
        error: `No cost found for '${name}' on plan '${plan.planTier}/${plan.billingCycle}'`,
      });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error("[Costs Service] Error getting provider cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/providers-costs/:name/history — all price points for a name (all plans)
router.get("/v1/providers-costs/:name/history", async (req, res) => {
  try {
    const { name } = req.params;

    const history = await db
      .select()
      .from(providersCosts)
      .where(eq(providersCosts.name, name))
      .orderBy(desc(providersCosts.effectiveFrom));

    if (history.length === 0) {
      res.status(404).json({ error: "Provider cost not found" });
      return;
    }

    res.json(history);
  } catch (err) {
    console.error("[Costs Service] Error getting provider cost history:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/providers-costs/:name/plans — all plan options for a cost name
router.get("/v1/providers-costs/:name/plans", async (req, res) => {
  try {
    const { name } = req.params;
    const now = new Date();

    // Get latest effective price per (plan_tier, billing_cycle) combo
    const allCosts = await db
      .select()
      .from(providersCosts)
      .where(and(eq(providersCosts.name, name), lte(providersCosts.effectiveFrom, now)))
      .orderBy(providersCosts.planTier, providersCosts.billingCycle, desc(providersCosts.effectiveFrom));

    if (allCosts.length === 0) {
      res.status(404).json({ error: "Provider cost not found" });
      return;
    }

    // Deduplicate: keep latest per (planTier, billingCycle)
    const seen = new Set<string>();
    const plans = allCosts.filter((row) => {
      const key = `${row.planTier}:${row.billingCycle}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json(plans);
  } catch (err) {
    console.error("[Costs Service] Error getting provider cost plans:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /v1/providers-costs/:name — insert new price point
router.put("/v1/providers-costs/:name", requireApiKey, async (req, res) => {
  try {
    const { name } = req.params;
    const parsed = PutProviderCostBodySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { costPerUnitInUsdCents, provider, planTier, billingCycle, effectiveFrom } = parsed.data;

    const [inserted] = await db
      .insert(providersCosts)
      .values({
        name,
        provider,
        planTier,
        billingCycle,
        costPerUnitInUsdCents: String(costPerUnitInUsdCents),
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      })
      .returning();

    res.json(inserted);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Provider cost with this name, plan, billing cycle, and effective_from already exists" });
      return;
    }
    console.error("[Costs Service] Error upserting provider cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /v1/providers-costs/:name — delete all entries for a name
router.delete("/v1/providers-costs/:name", requireApiKey, async (req, res) => {
  try {
    const { name } = req.params;

    const deleted = await db
      .delete(providersCosts)
      .where(eq(providersCosts.name, name))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: "Provider cost not found" });
      return;
    }

    res.json({ deleted: deleted.length });
  } catch (err) {
    console.error("[Costs Service] Error deleting provider cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
