import { Router } from "express";
import { eq, lte, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { providersCosts, platformCosts } from "../db/schema.js";
import { getTraceIdentityHeaders, traceEvent } from "../lib/trace-event.js";

const router = Router();

/**
 * The only two classes a price line can carry. A row is written with one of them by the seed
 * (TypeScript-required) or by PUT /v1/providers-costs/:name (Zod-required), and the column is
 * NOT NULL — but the public promise "no markup on what we route" is only worth anything if the
 * read path refuses to serve a line it cannot classify. So an unrecognised value is a 500, not
 * a guess and not an omitted field.
 */
const PRICING_BASES = ["marked-up", "pass-through"] as const;

function assertPricingBasis(name: string, basis: string): string {
  if (!(PRICING_BASES as readonly string[]).includes(basis)) {
    throw new Error(
      `Cost '${name}' has an unrecognised pricing_basis '${basis}'. Expected one of ${PRICING_BASES.join(", ")}.`
    );
  }
  return basis;
}

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
router.get("/v1/platform-prices", async (req, res) => {
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

    // 3. Filter by matching platform cost config, deduplicate per name.
    //
    // A name whose newest in-force row on the active plan carries a NULL price is DELISTED:
    // it has no billable price any more (the cold-email infrastructure lines, now on our own
    // fixed costs). It is dropped from this listing — and `seen` is marked first, so an older
    // priced version can never be served in its place, which would resurrect a price we
    // stopped charging. The name stays resolvable at `/v1/platform-prices/:name`.
    const seen = new Set<string>();
    const prices = allCosts
      .filter((row) => {
        if (seen.has(row.name)) return false;
        const plan = planMap.get(row.provider);
        if (!plan) return false;
        if (row.planTier !== plan.planTier || row.billingCycle !== plan.billingCycle) return false;
        seen.add(row.name);
        return row.costPerUnitInUsdCents !== null;
      })
      .map((row) => ({
        name: row.name,
        pricePerUnitInUsdCents: row.costPerUnitInUsdCents,
        // Always true here: a listed line is by definition one we still charge for.
        billable: true,
        provider: row.provider,
        providerDomain: row.providerDomain,
        type: row.type,
        unit: row.unit,
        pricingBasis: assertPricingBasis(row.name, row.pricingBasis),
        pricingRegime: row.pricingRegime,
        regimeHoursUtc: row.regimeHoursUtc,
        effectiveFrom: row.effectiveFrom,
      }));

    traceEvent({
      runId: req.headers["x-run-id"] as string | undefined,
      event: "platform_prices.listed",
      detail: `Listed ${prices.length} platform prices resolved from ${allCosts.length} candidate provider costs and ${planMap.size} active platform provider configs.`,
      identityHeaders: getTraceIdentityHeaders(req),
    });

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

    // 1. Find the provider for this cost name, from its NEWEST IN-FORCE row.
    // A name can carry rows from more than one provider once a vendor path is retired (the
    // Vercel AI Gateway left `vercel`-provider rows under the `deepseek-v4-*` names). An
    // unordered pick could read the superseded provider and then resolve the price against a
    // retired provider's plan — or 500 once that plan row is gone. The provider in force is
    // the one on the newest row whose effective_from has arrived, same row the price below
    // resolves to.
    const [anyCost] = await db
      .select({ provider: providersCosts.provider })
      .from(providersCosts)
      .where(and(eq(providersCosts.name, name), lte(providersCosts.effectiveFrom, now)))
      .orderBy(desc(providersCosts.effectiveFrom))
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

    // A NULL price is not a missing row — it is the current version of a line we stopped
    // charging for. Served as 200 with an explicit `billable: false` and a null price rather
    // than a 404 (the name must stay resolvable for spend already declared against it) and
    // rather than a zero (which would claim the line is free). A consumer that tries to price
    // new spend off it gets null, not a silently wrong number.
    res.json({
      name: result.name,
      pricePerUnitInUsdCents: result.costPerUnitInUsdCents,
      billable: result.costPerUnitInUsdCents !== null,
      provider: result.provider,
      providerDomain: result.providerDomain,
      type: result.type,
      unit: result.unit,
      pricingBasis: assertPricingBasis(result.name, result.pricingBasis),
      pricingRegime: result.pricingRegime,
      regimeHoursUtc: result.regimeHoursUtc,
      effectiveFrom: result.effectiveFrom,
    });
  } catch (err) {
    console.error("[Costs Service] Error getting platform price:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
