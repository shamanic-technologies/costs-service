import { Router } from "express";
import { eq, lte, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { costUnits } from "../db/schema.js";
import { requireApiKey } from "../middleware/auth.js";

const router = Router();

// GET /v1/costs — list all current prices (latest per name)
router.get("/v1/costs", async (_req, res) => {
  try {
    const now = new Date();
    // Get all distinct names with their latest effective price
    const allCosts = await db
      .select()
      .from(costUnits)
      .where(lte(costUnits.effectiveFrom, now))
      .orderBy(costUnits.name, desc(costUnits.effectiveFrom));

    // Deduplicate: keep only the first (latest) row per name
    const seen = new Set<string>();
    const current = allCosts.filter((row) => {
      if (seen.has(row.name)) return false;
      seen.add(row.name);
      return true;
    });

    res.json(current);
  } catch (err) {
    console.error("[Costs Service] Error listing costs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/costs/:name — current price for one name
router.get("/v1/costs/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const now = new Date();

    const result = await db
      .select()
      .from(costUnits)
      .where(and(eq(costUnits.name, name), lte(costUnits.effectiveFrom, now)))
      .orderBy(desc(costUnits.effectiveFrom))
      .limit(1);

    if (result.length === 0) {
      res.status(404).json({ error: "Cost unit not found" });
      return;
    }

    res.json(result[0]);
  } catch (err) {
    console.error("[Costs Service] Error getting cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /v1/costs/:name/history — all price points for a name
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

// PUT /v1/costs/:name — insert new price point
router.put("/v1/costs/:name", requireApiKey, async (req, res) => {
  try {
    const { name } = req.params;
    const { costPerUnitInUsdCents, effectiveFrom } = req.body;

    if (costPerUnitInUsdCents === undefined || costPerUnitInUsdCents === null) {
      res.status(400).json({ error: "costPerUnitInUsdCents is required" });
      return;
    }

    const [inserted] = await db
      .insert(costUnits)
      .values({
        name,
        costPerUnitInUsdCents: String(costPerUnitInUsdCents),
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      })
      .returning();

    res.json(inserted);
  } catch (err: any) {
    if (err?.code === "23505") {
      // Unique constraint violation (name + effective_from already exists)
      res.status(409).json({ error: "Cost unit with this name and effective_from already exists" });
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
