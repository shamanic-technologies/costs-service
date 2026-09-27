import { Router } from "express";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformCosts, providerCostVendorCosts, providersCosts } from "../db/schema.js";
import { requireApiKey } from "../middleware/auth.js";

/**
 * Vendor cost per price version — STAFF-ONLY, service-auth only.
 *
 * The vendor cost reveals our margin, so these routes sit under `/internal`, require the service
 * api key, and are served by nothing else. The public `/v1/platform-prices*` reads (the public
 * pricing page, the api-service gateway) and the `/v1/providers-costs*` reads are untouched.
 */
const router = Router();
router.use("/internal", requireApiKey);

type VersionRow = {
  pc: typeof providersCosts.$inferSelect;
  v: typeof providerCostVendorCosts.$inferSelect | null;
};

function toVersion({ pc, v }: VersionRow) {
  // Every version gets its vendor-cost row at write (seed boot step, PUT handler). Should one
  // ever be missing, it is not guessed at: it reads as unknown with its own reason.
  const vendor = v?.vendorCostPerUnitInUsdCents ?? null;
  return {
    id: pc.id,
    name: pc.name,
    provider: pc.provider,
    planTier: pc.planTier,
    billingCycle: pc.billingCycle,
    unit: pc.unit,
    pricingBasis: pc.pricingBasis,
    pricingRegime: pc.pricingRegime,
    billedPricePerUnitInUsdCents: pc.costPerUnitInUsdCents,
    vendorCostPerUnitInUsdCents: vendor,
    vendorCostKnown: vendor !== null,
    vendorCostUnknownReason: v ? v.unknownReason : "not-yet-stated",
    markupMultiplier: v?.markupMultiplier ?? null,
    vendorCostDerivation: v ? v.derivation : "unknown",
    effectiveFrom: pc.effectiveFrom,
    createdAt: pc.createdAt,
  };
}

// GET /internal/vendor-costs[?names=a,b] — every price version (all plans, all dates) with its
// vendor cost. Built for bulk joins: a consumer holding (cost name, billed unit price, date)
// matches on name + billedPricePerUnitInUsdCents, using effectiveFrom/createdAt as tie-break.
router.get("/internal/vendor-costs", async (req, res) => {
  try {
    const namesParam = typeof req.query.names === "string" ? req.query.names : undefined;
    const names = namesParam?.split(",").map((n) => n.trim()).filter(Boolean);

    const rows = await db
      .select({ pc: providersCosts, v: providerCostVendorCosts })
      .from(providersCosts)
      .leftJoin(providerCostVendorCosts, eq(providerCostVendorCosts.providerCostId, providersCosts.id))
      .where(names && names.length > 0 ? inArray(providersCosts.name, names) : undefined)
      .orderBy(asc(providersCosts.name), asc(providersCosts.effectiveFrom), asc(providersCosts.createdAt));

    res.json({ versions: rows.map(toVersion) });
  } catch (err) {
    console.error("[Costs Service] Error listing vendor costs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/vendor-costs/:name?at=<ISO> — the version that `/v1/platform-prices/:name` would
// have served at instant `at` (default now), with its vendor cost. "Would have served" means the
// row existed then (created_at <= at) and was in force (effective_from <= at), on the plan the
// provider was on at that instant — the exact unit price a consumer froze at that moment.
router.get("/internal/vendor-costs/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const atParam = typeof req.query.at === "string" ? req.query.at : undefined;
    const at = atParam ? new Date(atParam) : new Date();
    if (Number.isNaN(at.getTime())) {
      res.status(400).json({ error: `Invalid 'at': '${atParam}'. Expected an ISO-8601 instant.` });
      return;
    }
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
    if (!newest) {
      res.status(404).json({ error: `No price version of '${name}' was in force at ${at.toISOString()}` });
      return;
    }

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
      res.status(404).json({ error: `No platform plan for provider '${newest.provider}' was in force at ${at.toISOString()}` });
      return;
    }

    const [row] = await db
      .select({ pc: providersCosts, v: providerCostVendorCosts })
      .from(providersCosts)
      .leftJoin(providerCostVendorCosts, eq(providerCostVendorCosts.providerCostId, providersCosts.id))
      .where(
        and(
          existedAndInForce,
          eq(providersCosts.planTier, plan.planTier),
          eq(providersCosts.billingCycle, plan.billingCycle),
        ),
      )
      .orderBy(desc(providersCosts.effectiveFrom), desc(providersCosts.createdAt))
      .limit(1);
    if (!row) {
      res.status(404).json({
        error: `No price version of '${name}' on plan '${plan.planTier}/${plan.billingCycle}' was in force at ${at.toISOString()}`,
      });
      return;
    }

    res.json({ at: at.toISOString(), version: toVersion(row) });
  } catch (err) {
    console.error("[Costs Service] Error resolving vendor cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
