import { Router } from "express";
import { asc, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { providersCosts } from "../db/schema.js";
import { requireApiKey } from "../middleware/auth.js";
import { fetchLedgerVendors, LedgerError, matchVendors, paidFromAccounts, type CatalogueProvider } from "../lib/ledger.js";

/**
 * Which of OUR OWN accounts pays each catalogue provider, and when each last did —
 * STAFF-ONLY, service-auth only, read by the staff Monitoring > Providers table.
 *
 * Read on every request from Kevin's bank ledger (see `lib/ledger.ts`); nothing is stored or
 * cached here. A provider no ledger vendor matches is `match: "unmatched"`, never an empty
 * list that reads as "nobody pays it". A ledger that cannot answer is a 502 naming why.
 */
const router = Router();
router.use("/internal", requireApiKey);

/** Every catalogue provider with its newest non-null domain, sorted by provider. */
async function catalogueProviders(): Promise<CatalogueProvider[]> {
  const rows = await db
    .select({ provider: providersCosts.provider, providerDomain: providersCosts.providerDomain })
    .from(providersCosts)
    .orderBy(asc(providersCosts.provider), desc(providersCosts.effectiveFrom), desc(providersCosts.createdAt));
  const providers = new Map<string, string | null>();
  for (const r of rows) {
    if (!providers.has(r.provider)) providers.set(r.provider, r.providerDomain);
    else if (providers.get(r.provider) === null && r.providerDomain) providers.set(r.provider, r.providerDomain);
  }
  return [...providers].map(([provider, providerDomain]) => ({ provider, providerDomain }));
}

// GET /internal/provider-payment-sources — every catalogue provider, joined to the ledger.
router.get("/internal/provider-payment-sources", async (_req, res) => {
  try {
    const [providers, ledger] = await Promise.all([catalogueProviders(), fetchLedgerVendors()]);
    const matched = matchVendors(providers, ledger.vendors);
    res.json({
      ledgerGeneratedAt: ledger.generatedAt,
      providers: providers.map(({ provider, providerDomain }) => {
        const vendors = matched.get(provider) ?? [];
        if (vendors.length === 0) {
          return { provider, providerDomain, match: "unmatched", ledgerVendors: [], lastPaidOn: null, paidFrom: [] };
        }
        const paidFrom = paidFromAccounts(vendors);
        return {
          provider,
          providerDomain,
          match: "matched",
          ledgerVendors: vendors.map((v) => ({ key: v.key, name: v.name })),
          // paidFrom is most recent first; a matched vendor the ledger lists with no account is null, not a date.
          lastPaidOn: paidFrom.length > 0 ? paidFrom[0].lastPaidOn : null,
          paidFrom,
        };
      }),
    });
  } catch (err) {
    if (err instanceof LedgerError) {
      console.error("[Costs Service] Bank ledger read failed:", err.message);
      res.status(502).json({ error: err.message });
      return;
    }
    console.error("[Costs Service] Error listing provider payment sources:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
