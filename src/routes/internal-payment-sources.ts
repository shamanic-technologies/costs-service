import { Router } from "express";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { paymentSources, providerPaymentSources, providersCosts, type PaymentSource } from "../db/schema.js";
import { requireApiKey } from "../middleware/auth.js";
import {
  PAYMENT_SOURCE_KEY_PATTERN,
  PutPaymentSourceBodySchema,
  PutProviderPaymentSourcesBodySchema,
} from "../schemas.js";

/**
 * Which of OUR OWN payment accounts pays each vendor (Revolut Business, Qonto, Stripe...) —
 * STAFF-ONLY, service-auth only, read by the staff Monitoring > Cost table.
 *
 * The vocabulary (`payment_sources`) is closed: a provider can only be linked to a key staff
 * added first, and an unknown key is a 400 naming the known ones. Nothing is seeded per
 * provider — an empty `sources` list means the owner has not stated it yet.
 */
const router = Router();
router.use("/internal", requireApiKey);

function toSource(s: PaymentSource) {
  return { key: s.key, displayName: s.displayName, domain: s.domain };
}

/** Every catalogue provider with its newest non-null domain, sorted by provider. */
async function catalogueProviders(only?: string): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ provider: providersCosts.provider, providerDomain: providersCosts.providerDomain })
    .from(providersCosts)
    .where(only ? eq(providersCosts.provider, only) : undefined)
    .orderBy(asc(providersCosts.provider), desc(providersCosts.effectiveFrom), desc(providersCosts.createdAt));
  const providers = new Map<string, string | null>();
  for (const r of rows) {
    if (!providers.has(r.provider)) providers.set(r.provider, r.providerDomain);
    else if (providers.get(r.provider) === null && r.providerDomain) providers.set(r.provider, r.providerDomain);
  }
  return providers;
}

async function sourcesByProvider(only?: string): Promise<Map<string, ReturnType<typeof toSource>[]>> {
  const rows = await db
    .select({ provider: providerPaymentSources.provider, source: paymentSources })
    .from(providerPaymentSources)
    .innerJoin(paymentSources, eq(paymentSources.key, providerPaymentSources.sourceKey))
    .where(only ? eq(providerPaymentSources.provider, only) : undefined)
    .orderBy(asc(providerPaymentSources.provider), asc(paymentSources.key));
  const out = new Map<string, ReturnType<typeof toSource>[]>();
  for (const r of rows) {
    const list = out.get(r.provider) ?? [];
    list.push(toSource(r.source));
    out.set(r.provider, list);
  }
  return out;
}

// GET /internal/payment-sources — the vocabulary.
router.get("/internal/payment-sources", async (_req, res) => {
  try {
    const rows = await db.select().from(paymentSources).orderBy(asc(paymentSources.key));
    res.json({ sources: rows.map(toSource) });
  } catch (err) {
    console.error("[Costs Service] Error listing payment sources:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /internal/payment-sources/:key — staff grow the vocabulary (or fix a display name/domain).
router.put("/internal/payment-sources/:key", async (req, res) => {
  try {
    const { key } = req.params;
    if (!PAYMENT_SOURCE_KEY_PATTERN.test(key)) {
      res.status(400).json({ error: `Invalid payment source key '${key}': must match ${PAYMENT_SOURCE_KEY_PATTERN}` });
      return;
    }
    const parsed = PutPaymentSourceBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const [row] = await db
      .insert(paymentSources)
      .values({ key, displayName: parsed.data.displayName, domain: parsed.data.domain })
      .onConflictDoUpdate({
        target: paymentSources.key,
        set: { displayName: parsed.data.displayName, domain: parsed.data.domain, updatedAt: new Date() },
      })
      .returning();
    res.json(toSource(row));
  } catch (err) {
    console.error("[Costs Service] Error upserting payment source:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/provider-payment-sources — every catalogue provider, sources = [] when unset.
router.get("/internal/provider-payment-sources", async (_req, res) => {
  try {
    const [providers, sources] = await Promise.all([catalogueProviders(), sourcesByProvider()]);
    res.json({
      providers: [...providers].map(([provider, providerDomain]) => ({
        provider,
        providerDomain,
        sources: sources.get(provider) ?? [],
      })),
    });
  } catch (err) {
    console.error("[Costs Service] Error listing provider payment sources:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /internal/provider-payment-sources/:provider — replace the provider's set of sources.
router.put("/internal/provider-payment-sources/:provider", async (req, res) => {
  try {
    const { provider } = req.params;
    const parsed = PutProviderPaymentSourcesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const keys = [...new Set(parsed.data.sources)];

    const providers = await catalogueProviders(provider);
    if (!providers.has(provider)) {
      res.status(404).json({ error: `Provider '${provider}' is not in the cost catalogue` });
      return;
    }

    if (keys.length > 0) {
      const known = await db.select({ key: paymentSources.key }).from(paymentSources).where(inArray(paymentSources.key, keys));
      const knownKeys = new Set(known.map((k) => k.key));
      const unknown = keys.filter((k) => !knownKeys.has(k));
      if (unknown.length > 0) {
        const vocabulary = await db.select({ key: paymentSources.key }).from(paymentSources).orderBy(asc(paymentSources.key));
        res.status(400).json({
          error: `Unknown payment source(s): ${unknown.join(", ")}. Known sources: ${vocabulary.map((v) => v.key).join(", ")}. Add a new one with PUT /internal/payment-sources/:key first.`,
        });
        return;
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(providerPaymentSources).where(eq(providerPaymentSources.provider, provider));
      if (keys.length > 0) {
        await tx.insert(providerPaymentSources).values(keys.map((sourceKey) => ({ provider, sourceKey })));
      }
    });

    const sources = await sourcesByProvider(provider);
    res.json({ provider, providerDomain: providers.get(provider) ?? null, sources: sources.get(provider) ?? [] });
  } catch (err) {
    console.error("[Costs Service] Error setting provider payment sources:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
