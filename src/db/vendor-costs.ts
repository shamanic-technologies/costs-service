import type postgres from "postgres";
import { SEED_PROVIDERS_COSTS } from "./seed.js";
import {
  resolveVendorCost,
  seedVendorRatesByKey,
  type CatalogRowForVendorCost,
  type VendorCostResolution,
} from "../lib/vendor-cost.js";

/** Resolve a catalog row against the vendor rates the deployed seed states. */
export function resolveVendorCostFromSeed(row: CatalogRowForVendorCost): VendorCostResolution {
  return resolveVendorCost(row, seedVendorRatesByKey(SEED_PROVIDERS_COSTS));
}

/**
 * Give every `providers_costs` row that has none its vendor-cost row. Runs at boot, right after
 * the seed, so a version the seed has just appended is stated while the seed that wrote it (and
 * therefore the vendor rate it was computed from) is the code running. The first run on a
 * database also backfills the whole history — every row carries its `created_at`, which is what
 * decides the markup it was written under (see MARKUP_ERAS).
 *
 * WRITE-ONCE: a row that already has a vendor-cost row is never revisited, known or unknown.
 * A vendor rate edited in the seed later drops the old literal, so re-deriving an old row from a
 * newer seed could only lose evidence, never add it. `ON CONFLICT DO NOTHING` + an advisory lock
 * keep concurrent boots from double-writing.
 *
 * O(rows without a vendor cost): the whole catalog (hundreds of rows) on the first boot, the
 * handful of rows a deploy appends afterwards.
 */
export async function recordVendorCosts(): Promise<void> {
  const { default: postgres } = await import("postgres");
  const { directConnectionString } = await import("./index.js");
  const directSql = postgres(directConnectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const rates = seedVendorRatesByKey(SEED_PROVIDERS_COSTS);
    const written = await directSql.begin(async (tx) => {
      await tx.unsafe(`SELECT pg_advisory_xact_lock(911003)`);
      const pending = await tx.unsafe<
        {
          id: string;
          name: string;
          provider: string;
          plan_tier: string;
          billing_cycle: string;
          cost: string | null;
          pricing_basis: string;
          created_at: Date;
        }[]
      >(`
        SELECT pc.id, pc.name, pc.provider, pc.plan_tier, pc.billing_cycle,
               pc.cost_per_unit_in_usd_cents::text AS cost, pc.pricing_basis, pc.created_at
        FROM providers_costs pc
        LEFT JOIN provider_cost_vendor_costs v ON v.provider_cost_id = pc.id
        WHERE v.provider_cost_id IS NULL
      `);
      if (pending.length === 0) return 0;

      const values = pending.map((row) => {
        const resolved = resolveVendorCost(
          {
            name: row.name,
            provider: row.provider,
            planTier: row.plan_tier,
            billingCycle: row.billing_cycle,
            costPerUnitInUsdCents: row.cost,
            pricingBasis: row.pricing_basis,
            createdAt: new Date(row.created_at),
          },
          rates,
        );
        return {
          provider_cost_id: row.id,
          vendor_cost_per_unit_in_usd_cents: resolved.vendorCostPerUnitInUsdCents,
          markup_multiplier: resolved.markupMultiplier,
          derivation: resolved.derivation,
          unknown_reason: resolved.unknownReason,
        };
      });

      // postgres.js's TransactionSql type drops the tagged-template call signature; the object is
      // the same callable at runtime.
      const q = tx as unknown as postgres.Sql;
      await q`
        INSERT INTO provider_cost_vendor_costs ${q(
          values,
          "provider_cost_id",
          "vendor_cost_per_unit_in_usd_cents",
          "markup_multiplier",
          "derivation",
          "unknown_reason",
        )}
        ON CONFLICT (provider_cost_id) DO NOTHING
      `;
      return values.length;
    });

    const [{ missing }] = await directSql.unsafe<{ missing: number }[]>(`
      SELECT count(*)::int AS missing
      FROM providers_costs pc
      LEFT JOIN provider_cost_vendor_costs v ON v.provider_cost_id = pc.id
      WHERE v.provider_cost_id IS NULL
    `);
    if (missing > 0) {
      throw new Error(`[Costs Service] Vendor-cost verify failed: ${missing} price version(s) have no vendor-cost row. Aborting startup.`);
    }
    console.log(`[Costs Service] Vendor costs recorded (${written} new price version(s) stated)`);
  } finally {
    await directSql.end({ timeout: 5 });
  }
}
