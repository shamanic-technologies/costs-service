import { Router } from "express";
import { requireApiKey } from "../middleware/auth.js";
import { LedgerError } from "../lib/ledger.js";
import { RunsServiceError } from "../lib/runs-service.js";
import { endOfDay } from "../lib/catalogue-history.js";
import { compare, compareByGroup, type ConsumptionRow, type Interval } from "../lib/price-comparison.js";
import {
  PAY_AS_YOU_GO_VENDORS,
  PROPOSED_MULTIPLIER,
  PASS_THROUGH_MULTIPLIER,
  REAL_COST_SINCE,
  X1_RULE,
  EMAIL_SEND_COST_SHARES,
  CATALOGUE_VENDOR_COST_PROVIDERS,
} from "../lib/price-lists.js";
import { utcDay } from "../db/email-send-price.js";
import {
  consumptionByBrand,
  consumptionByOrg,
  goldForCostName,
  goldOnDay,
  loadCatalogueHistory,
  paygRatiosOnDay,
  paygSpend,
  realCostMap,
  realCostRefreshState,
  refreshRealCosts,
  RealCostRefreshInProgressError,
  type GoldRow,
} from "../db/real-cost.js";

/**
 * Real cost per unit of every cost item, the proposed price list (real x2, x1 for Stripe and
 * media), any price list at a date, and a replay of consumption under two lists. STAFF-ONLY
 * (service api key): it reveals our margin. DISPLAY ONLY: no billed price reads any of it.
 */
const router = Router();
router.use("/internal", requireApiKey);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: string | null) => (v === null ? null : Number(v));
const validDay = (d: unknown): d is string => typeof d === "string" && DAY_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

class BadRequest extends Error {}
class NotFound extends Error {}

function item(r: GoldRow) {
  const real = num(r.realCostUsdCents);
  const price = num(r.cataloguePriceUsdCents);
  const proposed = num(r.proposedPriceUsdCents);
  return {
    costName: r.costName,
    provider: r.provider,
    method: r.method,
    flag: r.flag,
    realCostPerUnitUsdCents: real,
    ratio: num(r.ratio),
    catalogueVendorCostPerUnitUsdCents: num(r.catalogueVendorCostUsdCents),
    cataloguePricePerUnitUsdCents: price,
    catalogueMarkupOnRealCost: real && price !== null && real > 0 ? Math.round((price / real) * 1e4) / 1e4 : null,
    multiplier: Number(r.multiplier),
    proposedPricePerUnitUsdCents: proposed,
    proposedBasis: r.proposedBasis,
    proposedVsCataloguePct: price && proposed !== null ? Math.round(((proposed - price) / price) * 1e6) / 1e4 : null,
  };
}

async function servedState() {
  const { lastAttempt, lastSucceeded } = await realCostRefreshState();
  const lastRefresh = lastAttempt && {
    status: lastAttempt.status,
    asOf: lastAttempt.asOf,
    startedAt: lastAttempt.startedAt.toISOString(),
    finishedAt: lastAttempt.finishedAt?.toISOString() ?? null,
    error: lastAttempt.error,
  };
  return { lastSucceeded, lastRefresh };
}

const RULES = {
  since: REAL_COST_SINCE,
  proposedMultiplier: PROPOSED_MULTIPLIER,
  passThroughMultiplier: PASS_THROUGH_MULTIPLIER,
  x1Rule: X1_RULE,
  emailSendCostShares: EMAIL_SEND_COST_SHARES,
  payAsYouGoVendors: PAY_AS_YOU_GO_VENDORS,
  catalogueVendorCostProviders: CATALOGUE_VENDOR_COST_PROVIDERS,
};

// GET /internal/real-costs[?day=YYYY-MM-DD] — every cost item's real cost and proposed price on a day (default: latest).
router.get("/internal/real-costs", async (req, res) => {
  try {
    const { lastSucceeded, lastRefresh } = await servedState();
    if (!lastSucceeded) {
      res.status(503).json({ error: "The real costs have not been computed yet", lastRefresh });
      return;
    }
    if (req.query.day !== undefined && !validDay(req.query.day)) {
      res.status(400).json({ error: "day must be a YYYY-MM-DD day" });
      return;
    }
    const day = (req.query.day as string | undefined) ?? lastSucceeded.asOf;
    if (day < REAL_COST_SINCE || day > lastSucceeded.asOf) {
      res.status(404).json({ error: `Real costs exist from ${REAL_COST_SINCE} through ${lastSucceeded.asOf}` });
      return;
    }
    const [rows, ratios, spend] = await Promise.all([goldOnDay(day), paygRatiosOnDay(day), paygSpend()]);
    res.json({
      formula: "real cost per unit of every cost item; proposed price = real cost x2 for production tools, x1 for Stripe and media",
      rules: RULES,
      day,
      asOf: lastSucceeded.asOf,
      refreshedAt: lastSucceeded.finishedAt!.toISOString(),
      stale: lastSucceeded.asOf < utcDay(new Date()),
      lastRefresh,
      payAsYouGo: ratios.map((r) => {
        const own = spend.filter((s) => s.provider === r.provider && s.day <= day);
        const paid = own.reduce((t, s) => t + s.paidUsdCents, 0);
        const refunded = own.reduce((t, s) => t + s.refundedUsdCents, 0);
        return {
          provider: r.provider,
          ledgerVendors: [...new Set(own.map((s) => s.vendor))].sort(),
          paidUsdCents: paid,
          refundedUsdCents: refunded,
          netPaidUsdCents: r.cumulativeNetPaidUsdCents,
          vendorCostRecordedUsdCents: Number(r.cumulativeVendorRecordedUsdCents),
          ratio: num(r.ratio),
        };
      }),
      items: rows.map(item),
    });
  } catch (err) {
    console.error("[Costs Service] Error reading the real costs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/real-costs/:costName — one item's daily series since 2026-01-01.
router.get("/internal/real-costs/:costName", async (req, res) => {
  try {
    const rows = await goldForCostName(req.params.costName);
    if (rows.length === 0) {
      res.status(404).json({ error: `No real cost series for '${req.params.costName}'` });
      return;
    }
    res.json({ costName: req.params.costName, daily: rows.map(({ costName: _c, ...r }) => ({ day: r.day, ...item({ ...r, costName: _c }) })) });
  } catch (err) {
    console.error("[Costs Service] Error reading a real cost series:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

type ListSpec = { source: "catalogue" | "proposed"; date: string };

function parseList(raw: unknown, name: string): ListSpec {
  if (typeof raw !== "string") throw new BadRequest(`${name} is required as <catalogue|proposed>:<YYYY-MM-DD>`);
  const [source, date] = raw.split(":");
  if ((source !== "catalogue" && source !== "proposed") || !validDay(date)) {
    throw new BadRequest(`${name} must be <catalogue|proposed>:<YYYY-MM-DD>, got '${raw}'`);
  }
  return { source, date };
}

type ListItem = { costName: string; provider: string | null; pricePerUnitUsdCents: number | null; detail: Record<string, unknown> };

/** A price list as it stood on a date: catalogue = the version in force at the day's end; proposed = that day's computed list. */
async function priceList(spec: ListSpec): Promise<ListItem[]> {
  if (spec.source === "catalogue") {
    const catalogue = await loadCatalogueHistory();
    const at = endOfDay(spec.date);
    return catalogue.names().flatMap((name) => {
      const { version } = catalogue.versionAt(name, at);
      if (!version) return [];
      return [
        {
          costName: name,
          provider: version.provider,
          pricePerUnitUsdCents: version.price,
          detail: { unit: version.unit, pricingBasis: version.pricingBasis, planTier: version.planTier, effectiveFrom: version.effectiveFrom.toISOString() },
        },
      ];
    });
  }
  const { lastSucceeded } = await realCostRefreshState();
  if (!lastSucceeded) throw new NotFound("The proposed list has not been computed yet");
  if (spec.date < REAL_COST_SINCE || spec.date > lastSucceeded.asOf) {
    throw new NotFound(`The proposed list exists from ${REAL_COST_SINCE} through ${lastSucceeded.asOf}`);
  }
  const rows = await goldOnDay(spec.date);
  return rows.map((r) => ({
    costName: r.costName,
    provider: r.provider,
    pricePerUnitUsdCents: num(r.proposedPriceUsdCents),
    detail: { proposedBasis: r.proposedBasis, realCostPerUnitUsdCents: num(r.realCostUsdCents), multiplier: Number(r.multiplier), method: r.method, flag: r.flag },
  }));
}

function sendError(res: import("express").Response, err: unknown, what: string) {
  if (err instanceof BadRequest) return void res.status(400).json({ error: err.message });
  if (err instanceof NotFound) return void res.status(404).json({ error: err.message });
  console.error(`[Costs Service] Error ${what}:`, err);
  res.status(500).json({ error: "Internal server error" });
}

// GET /internal/price-lists?source=catalogue|proposed&date=YYYY-MM-DD
router.get("/internal/price-lists", async (req, res) => {
  try {
    const spec = parseList(`${req.query.source}:${req.query.date}`, "source/date");
    const items = await priceList(spec);
    res.json({ source: spec.source, date: spec.date, items: items.map(({ detail, ...i }) => ({ ...i, ...detail })) });
  } catch (err) {
    sendError(res, err, "reading a price list");
  }
});

// GET /internal/price-comparison?list1=<source>:<day>&list2=<source>:<day>[&orgId=&brandId=][&interval=day|week|month]
router.get("/internal/price-comparison", async (req, res) => {
  try {
    const list1 = parseList(req.query.list1, "list1");
    const list2 = parseList(req.query.list2, "list2");
    const interval = (req.query.interval ?? "month") as Interval;
    if (!["day", "week", "month"].includes(interval)) throw new BadRequest("interval must be day, week or month");
    const orgId = req.query.orgId as string | undefined;
    const brandId = req.query.brandId as string | undefined;
    if (orgId !== undefined && !UUID_RE.test(orgId)) throw new BadRequest("orgId must be a UUID");
    if (brandId !== undefined && (typeof brandId !== "string" || brandId === "")) throw new BadRequest("brandId must be a string");
    if (brandId !== undefined && orgId === undefined) throw new BadRequest("brandId needs its orgId (perimeter = one org x brand)");

    const { lastSucceeded, lastRefresh } = await servedState();
    if (!lastSucceeded) {
      res.status(503).json({ error: "The real costs have not been computed yet", lastRefresh });
      return;
    }
    const [items1, items2, realCost, rows] = await Promise.all([
      priceList(list1),
      priceList(list2),
      realCostMap(),
      brandId ? consumptionByBrand(orgId, brandId) : consumptionByOrg(orgId),
    ]);
    const price1 = new Map(items1.map((i) => [i.costName, i.pricePerUnitUsdCents]));
    const price2 = new Map(items2.map((i) => [i.costName, i.pricePerUnitUsdCents]));
    const result = compare({ rows, price1, price2, realCost, interval });

    let byOrg: unknown = null;
    let byBrand: unknown = null;
    if (!orgId) {
      byOrg = compareByGroup({ rows, price1, price2, realCost }, (r: ConsumptionRow) => r.orgId ?? "").map(({ key, ...f }) => ({
        orgId: key === "" ? null : key,
        ...f,
      }));
      const brandRows = await consumptionByBrand();
      byBrand = compareByGroup({ rows: brandRows, price1, price2, realCost }, (r) => `${r.orgId ?? ""}|${r.brandId ?? ""}`).map(({ key, ...f }) => {
        const [o, b] = key.split("|");
        return { orgId: o === "" ? null : o, brandId: b === "" ? null : b, ...f };
      });
    }

    res.json({
      perimeter: brandId ? { grain: "org-brand", orgId, brandId } : orgId ? { grain: "org", orgId } : { grain: "fleet" },
      list1,
      list2,
      interval,
      consumptionAsOf: lastSucceeded.finishedAt!.toISOString(),
      stale: lastSucceeded.asOf < utcDay(new Date()),
      notes: [
        "Amounts replay every unit runs-service counted (actual and refunded rows, both key sources) at quantity x the list's price.",
        "Real cost = quantity x the real cost per unit of the consumption day; units through a customer's own key cost us nothing unless declared ours (Serper, Apify).",
        "Billed = what runs-service actually charged: gross, net of the per-org discount, and the platform-key part (= the margin read's billed).",
        "Per brand, a co-branded run counts under each of its brands, so brand rows sum above the org.",
      ],
      ...result,
      byOrg,
      byBrand,
    });
  } catch (err) {
    sendError(res, err, "comparing price lists");
  }
});

// POST /internal/real-costs/refresh — recompute now (the daily one runs on its own).
router.post("/internal/real-costs/refresh", async (_req, res) => {
  try {
    res.json(await refreshRealCosts());
  } catch (err) {
    if (err instanceof RealCostRefreshInProgressError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof LedgerError || err instanceof RunsServiceError) {
      console.error("[Costs Service] Real cost refresh failed upstream:", err.message);
      res.status(502).json({ error: err.message });
      return;
    }
    console.error("[Costs Service] Real cost refresh failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
