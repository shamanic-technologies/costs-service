import { Router } from "express";
import { eq, lte, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { costUnits, platformPlans } from "../db/schema.js";
import { requireApiKey } from "../middleware/auth.js";
import { PutCostBodySchema } from "../schemas.js";

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

// GET /v1/costs — list all current prices (resolved via platform plan)
router.get("/v1/costs", async (_req, res) => {
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
      .from(costUnits)
      .where(lte(costUnits.effectiveFrom, now))
      .orderBy(costUnits.name, desc(costUnits.effectiveFrom));

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
    console.error("[Costs Service] Error listing costs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/costs/:name — current price for one name (resolved via platform plan)
router.get("/v1/costs/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const now = new Date();

    // 1. Find the provider for this cost name
    const [anyCost] = await db
      .select({ provider: costUnits.provider })
      .from(costUnits)
      .where(eq(costUnits.name, name))
      .limit(1);

    if (!anyCost) {
      res.status(404).json({ error: "Cost unit not found" });
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
      .from(costUnits)
      .where(
        and(
          eq(costUnits.name, name),
          eq(costUnits.planTier, plan.planTier),
          eq(costUnits.billingCycle, plan.billingCycle),
          lte(costUnits.effectiveFrom, now),
        ),
      )
      .orderBy(desc(costUnits.effectiveFrom))
      .limit(1);

    if (!result) {
      res.status(404).json({
        error: `No cost found for '${name}' on plan '${plan.planTier}/${plan.billingCycle}'`,
      });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error("[Costs Service] Error getting cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/costs/:name/history — all price points for a name (all plans)
router.get("/v1/costs/:name/history", async (req, res) => {
  try {
    const { name } = req.params;

    const history = await db
      .select()
      .from(costUnits)
      .where(eq(costUnits.name, name))
      .orderBy(desc(costUnits.effectiveFrom));

    if (history.length === 0) {
      res.status(404).json({ error: "Cost unit not found" });
      return;
    }

    res.json(history);
  } catch (err) {
    console.error("[Costs Service] Error getting cost history:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/costs/:name/plans — all plan options for a cost name
router.get("/v1/costs/:name/plans", async (req, res) => {
  try {
    const { name } = req.params;
    const now = new Date();

    // Get latest effective price per (plan_tier, billing_cycle) combo
    const allCosts = await db
      .select()
      .from(costUnits)
      .where(and(eq(costUnits.name, name), lte(costUnits.effectiveFrom, now)))
      .orderBy(costUnits.planTier, costUnits.billingCycle, desc(costUnits.effectiveFrom));

    if (allCosts.length === 0) {
      res.status(404).json({ error: "Cost unit not found" });
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
    console.error("[Costs Service] Error getting cost plans:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /v1/costs/:name — insert new price point
router.put("/v1/costs/:name", requireApiKey, async (req, res) => {
  try {
    const { name } = req.params;
    const parsed = PutCostBodySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { costPerUnitInUsdCents, provider, planTier, billingCycle, effectiveFrom } = parsed.data;

    const [inserted] = await db
      .insert(costUnits)
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
      res.status(409).json({ error: "Cost unit with this name, plan, billing cycle, and effective_from already exists" });
      return;
    }
    console.error("[Costs Service] Error upserting cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /v1/costs/:name — delete all entries for a name
router.delete("/v1/costs/:name", requireApiKey, async (req, res) => {
  try {
    const { name } = req.params;

    const deleted = await db
      .delete(costUnits)
      .where(eq(costUnits.name, name))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: "Cost unit not found" });
      return;
    }

    res.json({ deleted: deleted.length });
  } catch (err) {
    console.error("[Costs Service] Error deleting cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
