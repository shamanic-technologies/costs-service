import { Router } from "express";
import { requireApiKey } from "../middleware/auth.js";
import { LedgerError } from "../lib/ledger.js";
import { RunsServiceError } from "../lib/runs-service.js";
import { TwilioUsageError } from "../lib/twilio-usage.js";
import { endOfDay } from "../lib/catalogue-history.js";
import { compare, compareByGroup, type ConsumptionRow, type Interval } from "../lib/price-comparison.js";
import { replayRealCost } from "../lib/real-cost.js";
import {
  PAY_AS_YOU_GO_VENDORS,
  PROPOSED_MULTIPLIER,
  PASS_THROUGH_MULTIPLIER,
  REAL_COST_SINCE,
  X1_RULE,
  EMAIL_SEND_COST_SHARES,
  CATALOGUE_VENDOR_COST_PROVIDERS,
  INCLUDED_AT_VENDOR,
  LEGACY_COST_NAMES,
} from "../lib/price-lists.js";
import { utcDay } from "../db/email-send-price.js";
import { VAT_RULE, vatTakenOut } from "../lib/email-send-price.js";
import { lastCatalogueSyncs } from "../db/catalogue-sync.js";
import {
  consumptionByBrand,
  consumptionByOrg,
  goldForCostName,
  goldOnDay,
  loadCatalogueHistory,
  paygParts,
  paygRatiosOnDay,
  paygSpend,
  realCostPoints,
  realCostRefreshState,
  refreshRealCosts,
  RealCostRefreshInProgressError,
  type GoldRow,
} from "../db/real-cost.js";

/**
 * Real cost per unit of every cost item, the proposed price list (real x2, x1 for Stripe and
 * media), any price list at a date, and a replay of consumption under two lists. STAFF-ONLY
 * (service api key): it reveals our margin. Since 2026-10-02 the day's proposed list IS the billed
 * catalogue price: each refresh applies it (src/db/catalogue-sync.ts, `/internal/catalogue-syncs`).
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
    /** Set only when the subscription floor applied: the averaged real cost x2 the vendor list cost replaced. */
    averagedProposedPricePerUnitUsdCents: num(r.proposedBeforeFloorUsdCents),
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

type PartRow = Awaited<ReturnType<typeof paygParts>>[number];

/** Every part a split vendor can report, in serving order. Only `metered` is loaded on units. */
const PART_RULES: Record<string, { loadedOnUnits: boolean; flag: string | null }> = {
  metered: { loadedOnUnits: true, flag: null },
  rental: { loadedOnUnits: false, flag: "subscription-not-loaded-on-units" },
  other: { loadedOnUnits: false, flag: "other-usage-not-loaded-on-units" },
  "metered-uncovered": { loadedOnUnits: true, flag: "inferred-before-export" },
  "other-services": { loadedOnUnits: false, flag: "other-services-not-loaded-on-units" },
  "other-services-uncovered": { loadedOnUnits: false, flag: "other-services-not-loaded-on-units" },
  outstanding: { loadedOnUnits: false, flag: "billed-not-collected-yet" },
  tax: { loadedOnUnits: false, flag: "tax-not-real-cost" },
  adjustments: { loadedOnUnits: false, flag: "adjustment-not-loaded-on-units" },
  prepaid: { loadedOnUnits: false, flag: "prepaid-counted-only-as-consumed" },
  "unconsumed-balance": { loadedOnUnits: false, flag: "prepaid-not-consumed" },
};
const SNAPSHOT_PARTS = new Set(["unconsumed-balance"]);
const PARTS_BY_BASIS: Record<string, string[]> = {
  "twilio-usage-metered": ["metered", "rental", "other", "unconsumed-balance"],
  "google-cloud-split-metered": ["metered", "metered-uncovered", "other-services", "other-services-uncovered", "tax", "adjustments", "prepaid", "outstanding"],
};

/** What a split vendor's remainder is known to be made of, once every part is served. */
const UNEXPLAINED_BASIS: Record<string, string> = {
  "google-cloud-split-metered":
    "bank net paid VAT included - every part above (tax is one of them): bank money before the billing export began (no service line says what it paid) and exchange-rate cents; never loaded on units",
};

const r2 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Where a split vendor's bank money went, through `day`: each part as the vendor reports it
 * (cumulative), and the bank money no part explains (net paid - every part). Only the metered part
 * is loaded on units (the ratio's numerator); every other part is served, flagged, never loaded. A
 * snapshot part (Twilio's balance left) exists only on the refresh day, so on an earlier day it and
 * the remainder are null.
 */
function vendorSplit(provider: string, basis: string, day: string, asOf: string, netPaid: number, vat: number, parts: PartRow[]) {
  const all = parts.filter((p) => p.provider === provider);
  const names = PARTS_BY_BASIS[basis];
  if (!names) throw new Error(`No part list for numerator basis '${basis}'`);
  const unknown = [...new Set(all.map((p) => p.part))].filter((part) => !names.includes(part));
  if (unknown.length > 0) throw new Error(`Unknown vendor part(s) for ${provider}: ${unknown.join(", ")}`);
  let snapshotMissing = false;
  const out = names.map((part) => {
    const rows = SNAPSHOT_PARTS.has(part) ? all.filter((p) => p.part === part && p.day === day && day === asOf) : all.filter((p) => p.part === part && p.day <= day);
    if (SNAPSHOT_PARTS.has(part) && rows.length === 0) snapshotMissing = true;
    const usdCents = SNAPSHOT_PARTS.has(part) && rows.length === 0 ? null : r2(rows.reduce((t, p) => t + Number(p.usdCents), 0));
    // A cumulative part can span several monthly EUR->USD rates: name every basis it sums, not the first.
    const bases = [...new Set((rows.length > 0 ? rows : all.filter((p) => p.part === part)).map((p) => p.basis))];
    return { part, usdCents, basis: bases.length > 0 ? bases.join(" | ") : null, ...PART_RULES[part] };
  });
  const explained = out.reduce((t, p) => t + (p.usdCents ?? 0), 0);
  // A split that serves the vendor's own tax as a part (Google Cloud) states the bank money it
  // explains VAT included, so its remainder is taken on what the bank paid, VAT included.
  const bank = names.includes("tax") ? netPaid + vat : netPaid;
  return {
    parts: out,
    unexplained: {
      usdCents: snapshotMissing ? null : r2(bank - explained),
      basis: UNEXPLAINED_BASIS[basis] ?? "bank net paid - every part above; never loaded on units",
      loadedOnUnits: false as const,
      flag: snapshotMissing ? "balance-known-only-on-refresh-day" : "unexplained-not-loaded-on-units",
    },
  };
}

const RULES = {
  since: REAL_COST_SINCE,
  vatRule: VAT_RULE,
  proposedMultiplier: PROPOSED_MULTIPLIER,
  passThroughMultiplier: PASS_THROUGH_MULTIPLIER,
  x1Rule: X1_RULE,
  emailSendCostShares: EMAIL_SEND_COST_SHARES,
  payAsYouGoVendors: PAY_AS_YOU_GO_VENDORS,
  catalogueVendorCostProviders: CATALOGUE_VENDOR_COST_PROVIDERS,
  includedAtVendor: INCLUDED_AT_VENDOR,
  legacyCostNames: LEGACY_COST_NAMES,
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
    const [rows, ratios, spend, parts] = await Promise.all([goldOnDay(day), paygRatiosOnDay(day), paygSpend(), paygParts()]);
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
        const vat = vatTakenOut(own);
        return {
          provider: r.provider,
          ledgerVendors: [...new Set(own.map((s) => s.vendor))].sort(),
          paidUsdCents: paid,
          refundedUsdCents: refunded,
          netPaidUsdCents: r.cumulativeNetPaidUsdCents,
          vatUsdCents: vat.vatUsdCents,
          vatBasis: vat.vatBasis,
          numeratorBasis: r.numeratorBasis,
          meteredUsdCents: Number(r.cumulativeMeteredUsdCents),
          vendorCostRecordedUsdCents: Number(r.cumulativeVendorRecordedUsdCents),
          ratio: num(r.ratio),
          ...internalCost(r),
          split: r.numeratorBasis === "ledger-net-paid" ? null : vendorSplit(r.provider, r.numeratorBasis, day, lastSucceeded.asOf, r.cumulativeNetPaidUsdCents, vat.vatUsdCents, parts),
        };
      }),
      items: rows.map(item),
    });
  } catch (err) {
    console.error("[Costs Service] Error reading the real costs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/real-costs/basis-summary[?day=YYYY-MM-DD] — the fleet since 2026-01-01 per pricing basis,
// at the day's catalogue and proposed lists (default: latest), plus each API vendor's internal cost.
router.get("/internal/real-costs/basis-summary", async (req, res) => {
  try {
    const { lastSucceeded, lastRefresh } = await servedState();
    if (!lastSucceeded) {
      res.status(503).json({ error: "The real costs have not been computed yet", lastRefresh });
      return;
    }
    if (req.query.day !== undefined && !validDay(req.query.day)) throw new BadRequest("day must be a YYYY-MM-DD day");
    const day = (req.query.day as string | undefined) ?? lastSucceeded.asOf;
    if (day < REAL_COST_SINCE || day > lastSucceeded.asOf) throw new NotFound(`Real costs exist from ${REAL_COST_SINCE} through ${lastSucceeded.asOf}`);
    const [gold, ratios, rows, inputs] = await Promise.all([
      goldOnDay(day),
      paygRatiosOnDay(day),
      consumptionByOrg(),
      comparisonInputs({ source: "catalogue", date: day }, { source: "proposed", date: day }),
    ]);
    const result = compare({ rows, ...inputs, interval: "month" });
    const basisOf = new Map(gold.map((g) => [g.costName, BASIS_OF_METHOD[g.method] ?? "unknown"]));
    const unknownMethods = [...new Set(gold.map((g) => g.method))].filter((m) => !BASIS_OF_METHOD[m]);
    if (unknownMethods.length > 0) throw new Error(`No pricing basis for real-cost method(s): ${unknownMethods.join(", ")}`);
    const bases = [...BASIS_ORDER, "not-on-the-day-list"].map((basis) => {
      const items = gold.filter((g) => basisOf.get(g.costName) === basis);
      const consumed = result.costItems.filter((c) => (basisOf.get(c.costName) ?? "not-on-the-day-list") === basis);
      return {
        basis,
        providers: [...new Set(items.map((g) => g.provider).filter((p): p is string => p !== null))].sort(),
        itemCount: items.length,
        consumedItemCount: consumed.length,
        flooredItemCount: items.filter((g) => g.proposedBasis === "vendor-list-cost-floor").length,
        flooredItems: items.filter((g) => g.proposedBasis === "vendor-list-cost-floor").map((g) => g.costName).sort(),
        realCostUsdCents: r2(consumed.reduce((t, c) => t + c.realCostUsdCents, 0)),
        amountCatalogueUsdCents: r2(consumed.reduce((t, c) => t + c.amount1UsdCents, 0)),
        amountProposedUsdCents: r2(consumed.reduce((t, c) => t + c.amount2UsdCents, 0)),
      };
    });
    const internal = ratios.map((r) => ({ provider: r.provider, netPaidUsdCents: r.cumulativeNetPaidUsdCents, ...internalCost(r) }));
    res.json({
      day,
      asOf: lastSucceeded.asOf,
      stale: lastSucceeded.asOf < utcDay(new Date()),
      perimeter: { grain: "fleet", since: REAL_COST_SINCE },
      lists: { catalogue: `catalogue:${day}`, proposed: `proposed:${day}` },
      rule: "Averaging (bank money / units) only for flat fees: email infrastructure and vendor subscriptions. Every pay-as-you-go API at its catalogue list cost; proposed = real cost x2, x1 for pass-through (Stripe, media). A subscription credit is never proposed below its vendor list cost per unit (floored, proposedBasis vendor-list-cost-floor). What the bank paid an API vendor beyond its list cost is internal, outside clients.",
      bases,
      totals: result.totals,
      unpricedCostNames2: result.unpricedCostNames2,
      realCostUnknownCostNames: result.realCostUnknownCostNames,
      internalCost: {
        byVendor: internal,
        totalUsdCents: r2(internal.reduce((t, i) => t + i.internalCostUsdCents, 0)),
      },
    });
  } catch (err) {
    sendError(res, err, "reading the basis summary");
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

/** The two price lists and the replayed real cost of one unit, shared by the comparison and the basis summary. */
async function comparisonInputs(list1: ListSpec, list2: ListSpec) {
  const [items1, items2, points] = await Promise.all([priceList(list1), priceList(list2), realCostPoints()]);
  return {
    price1: new Map(items1.map((i) => [i.costName, i.pricePerUnitUsdCents])),
    price2: new Map(items2.map((i) => [i.costName, i.pricePerUnitUsdCents])),
    realCost: replayRealCost(points),
  };
}

/**
 * What the bank paid a pay-as-you-go vendor (net, excluding VAT) beyond the list cost our runs
 * recorded: Anthropic seat or test spend, Gemini outside runs, Twilio rental... Internal, outside
 * clients, never loaded on a unit (owner rule 2026-10-01).
 */
function internalCost(r: { cumulativeNetPaidUsdCents: number; cumulativeVendorRecordedAllUsdCents: string }) {
  return {
    vendorCostRecordedAtListUsdCents: Number(r.cumulativeVendorRecordedAllUsdCents),
    internalCostUsdCents: r2(r.cumulativeNetPaidUsdCents - Number(r.cumulativeVendorRecordedAllUsdCents)),
    internalCostBasis: "bank net paid excluding VAT since 2026-01-01 - vendor cost our runs recorded at list price; internal, not billed to clients, never loaded on a unit",
  };
}

/** The pricing basis each real-cost method belongs to (owner rule 2026-10-01). */
const BASIS_OF_METHOD: Record<string, string> = {
  "email-send-price": "email-infrastructure-averaged",
  subscription: "subscription-averaged",
  "api-list-cost": "api-list-cost",
  "pass-through": "pass-through-x1",
  "catalogue-vendor-cost": "catalogue-vendor-cost-flagged",
  "included-at-vendor": "included-at-vendor",
};
const BASIS_ORDER = Object.values(BASIS_OF_METHOD);

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
    const rows = await (brandId ? consumptionByBrand(orgId, brandId) : consumptionByOrg(orgId));
    const { price1, price2, realCost } = await comparisonInputs(list1, list2);
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
        "Real cost = quantity x the real cost of one unit: spend paid as a flat fee (email infrastructure, subscriptions) is spread over every unit since 2026-01-01 at its latest value, so summed over units it equals what we paid; an API is at its list cost of the consumption day (owner rule 2026-10-01: no averaging for APIs, what the bank paid beyond list cost is internal). Units through a customer's own key cost us nothing unless declared ours (Serper, Apify).",
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

// GET /internal/catalogue-syncs — the last attempts to bill the proposed list.
router.get("/internal/catalogue-syncs", async (_req, res) => {
  try {
    res.json({ syncs: await lastCatalogueSyncs(10) });
  } catch (err) {
    sendError(res, err, "reading catalogue syncs");
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
    if (err instanceof LedgerError || err instanceof RunsServiceError || err instanceof TwilioUsageError) {
      console.error("[Costs Service] Real cost refresh failed upstream:", err.message);
      res.status(502).json({ error: err.message });
      return;
    }
    console.error("[Costs Service] Real cost refresh failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
