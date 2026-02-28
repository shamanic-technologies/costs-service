import { Router } from "express";
import { eq, lte, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformPlans } from "../db/schema.js";
import { requireApiKey } from "../middleware/auth.js";
import { PutPlatformPlanBodySchema } from "../schemas.js";

const router = Router();

// GET /v1/platform-plans — list current plan per provider
router.get("/v1/platform-plans", async (_req, res) => {
  try {
    const now = new Date();

    const allPlans = await db
      .select()
      .from(platformPlans)
      .where(lte(platformPlans.effectiveFrom, now))
      .orderBy(platformPlans.provider, desc(platformPlans.effectiveFrom));

    // Deduplicate: keep only the latest per provider
    const seen = new Set<string>();
    const current = allPlans.filter((row) => {
      if (seen.has(row.provider)) return false;
      seen.add(row.provider);
      return true;
    });

    res.json(current);
  } catch (err) {
    console.error("[Costs Service] Error listing platform plans:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/platform-plans/:provider — current plan for a provider
router.get("/v1/platform-plans/:provider", async (req, res) => {
  try {
    const { provider } = req.params;
    const now = new Date();

    const [result] = await db
      .select()
      .from(platformPlans)
      .where(and(eq(platformPlans.provider, provider), lte(platformPlans.effectiveFrom, now)))
      .orderBy(desc(platformPlans.effectiveFrom))
      .limit(1);

    if (!result) {
      res.status(404).json({ error: `No platform plan configured for provider '${provider}'` });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error("[Costs Service] Error getting platform plan:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/platform-plans/:provider/history — plan change history
router.get("/v1/platform-plans/:provider/history", async (req, res) => {
  try {
    const { provider } = req.params;

    const history = await db
      .select()
      .from(platformPlans)
      .where(eq(platformPlans.provider, provider))
      .orderBy(desc(platformPlans.effectiveFrom));

    if (history.length === 0) {
      res.status(404).json({ error: `No platform plan configured for provider '${provider}'` });
      return;
    }

    res.json(history);
  } catch (err) {
    console.error("[Costs Service] Error getting platform plan history:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /v1/platform-plans/:provider — set/update plan
router.put("/v1/platform-plans/:provider", requireApiKey, async (req, res) => {
  try {
    const { provider } = req.params;
    const parsed = PutPlatformPlanBodySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { planTier, billingCycle, effectiveFrom } = parsed.data;

    const [inserted] = await db
      .insert(platformPlans)
      .values({
        provider,
        planTier,
        billingCycle,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      })
      .returning();

    res.json(inserted);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Platform plan for this provider and effective_from already exists" });
      return;
    }
    console.error("[Costs Service] Error upserting platform plan:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
