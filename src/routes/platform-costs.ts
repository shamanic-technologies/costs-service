import { Router } from "express";
import { eq, lte, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformCosts } from "../db/schema.js";
import { requireApiKey } from "../middleware/auth.js";
import { PutPlatformCostBodySchema } from "../schemas.js";

const router = Router();

// GET /v1/platform-costs — list current cost config per provider
router.get("/v1/platform-costs", async (_req, res) => {
  try {
    const now = new Date();

    const allCosts = await db
      .select()
      .from(platformCosts)
      .where(lte(platformCosts.effectiveFrom, now))
      .orderBy(platformCosts.provider, desc(platformCosts.effectiveFrom));

    // Deduplicate: keep only the latest per provider
    const seen = new Set<string>();
    const current = allCosts.filter((row) => {
      if (seen.has(row.provider)) return false;
      seen.add(row.provider);
      return true;
    });

    res.json(current);
  } catch (err) {
    console.error("[Costs Service] Error listing platform costs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/platform-costs/:provider — current cost config for a provider
router.get("/v1/platform-costs/:provider", async (req, res) => {
  try {
    const { provider } = req.params;
    const now = new Date();

    const [result] = await db
      .select()
      .from(platformCosts)
      .where(and(eq(platformCosts.provider, provider), lte(platformCosts.effectiveFrom, now)))
      .orderBy(desc(platformCosts.effectiveFrom))
      .limit(1);

    if (!result) {
      res.status(404).json({ error: `No platform cost configured for provider '${provider}'` });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error("[Costs Service] Error getting platform cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/platform-costs/:provider/history — cost config change history
router.get("/v1/platform-costs/:provider/history", async (req, res) => {
  try {
    const { provider } = req.params;

    const history = await db
      .select()
      .from(platformCosts)
      .where(eq(platformCosts.provider, provider))
      .orderBy(desc(platformCosts.effectiveFrom));

    if (history.length === 0) {
      res.status(404).json({ error: `No platform cost configured for provider '${provider}'` });
      return;
    }

    res.json(history);
  } catch (err) {
    console.error("[Costs Service] Error getting platform cost history:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /v1/platform-costs/:provider — set/update cost config
router.put("/v1/platform-costs/:provider", requireApiKey, async (req, res) => {
  try {
    const { provider } = req.params;
    const parsed = PutPlatformCostBodySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { planTier, billingCycle, effectiveFrom } = parsed.data;

    const [inserted] = await db
      .insert(platformCosts)
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
      res.status(409).json({ error: "Platform cost for this provider and effective_from already exists" });
      return;
    }
    console.error("[Costs Service] Error upserting platform cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
