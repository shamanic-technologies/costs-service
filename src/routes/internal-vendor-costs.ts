import { Router } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { providerCostVendorCosts, providersCosts } from "../db/schema.js";
import { catalogueVersionAt } from "../db/catalogue-version.js";
import { requireApiKey } from "../middleware/auth.js";
import { RECONSTRUCTED_PRICE_VERSIONS, type ReconstructedPriceVersion } from "../lib/vendor-cost-statements.js";

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
    vendorCostNote: null,
    reconstructed: false,
    effectiveFrom: pc.effectiveFrom,
    createdAt: pc.createdAt,
  };
}

/**
 * A version overwritten in place before v0.25.0 (see vendor-cost-statements.ts). It is NOT in
 * `providers_costs` and never will be; it is listed so a consumer pricing a cost row that froze
 * its price by (name, billed unit price, date) finds it. `servedFrom` stands in for both dates.
 */
function toReconstructedVersion(r: ReconstructedPriceVersion) {
  return {
    id: `reconstructed:${r.name}:${r.planTier}:${r.billedPricePerUnitInUsdCents}`,
    name: r.name,
    provider: r.provider,
    planTier: r.planTier,
    billingCycle: r.billingCycle,
    unit: null,
    pricingBasis: "marked-up",
    pricingRegime: null,
    billedPricePerUnitInUsdCents: r.billedPricePerUnitInUsdCents,
    vendorCostPerUnitInUsdCents: r.vendorCostPerUnitInUsdCents,
    vendorCostKnown: true,
    vendorCostUnknownReason: null,
    // Null on purpose: a reconstructed version has no successor row to end it, so a reader of
    // "the markups in force now" (the admin's store-markup card) would count a retired name's
    // 2026-02 price as a current line. It exists to price old cost rows, not to state a markup.
    markupMultiplier: null,
    vendorCostDerivation: r.derivation,
    vendorCostNote: r.note,
    reconstructed: true,
    effectiveFrom: r.servedFrom,
    createdAt: r.servedFrom,
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

    const reconstructed = RECONSTRUCTED_PRICE_VERSIONS.filter((r) => !names || names.length === 0 || names.includes(r.name));
    res.json({ versions: [...rows.map(toVersion), ...reconstructed.map(toReconstructedVersion)] });
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
    const resolved = await catalogueVersionAt(name, at);
    if (!resolved.found) {
      res.status(404).json({ error: resolved.reason });
      return;
    }

    res.json({ at: at.toISOString(), version: toVersion(resolved.row) });
  } catch (err) {
    console.error("[Costs Service] Error resolving vendor cost:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
