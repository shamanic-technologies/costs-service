import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROVIDER_DOMAINS, SEED_PLATFORM_COSTS, SEED_PROVIDERS_COSTS } from "../../src/db/seed.js";

// OPEN-LLM-DROP-1124: Cerebras and Groq were seeded and dropped on 2026-11-24 (no key, no spend).
// The seed must not declare them again, and migration 0023 deletes their production rows.
describe("Cerebras and Groq are dropped (OPEN-LLM-DROP-1124)", () => {
  it("seeds no cerebras/groq cost, platform cost or domain", () => {
    expect(SEED_PROVIDERS_COSTS.filter((c) => /^(cerebras|groq)-/.test(c.name) || ["cerebras", "groq"].includes(c.provider))).toEqual([]);
    expect(SEED_PLATFORM_COSTS.filter((p) => ["cerebras", "groq"].includes(p.provider))).toEqual([]);
    expect(PROVIDER_DOMAINS.cerebras).toBeUndefined();
    expect(PROVIDER_DOMAINS.groq).toBeUndefined();
  });

  it("migration 0023 deletes vendor costs before the cost rows they reference", () => {
    const sql = readFileSync(new URL("../../drizzle/0023_drop_cerebras_groq.sql", import.meta.url), "utf8");
    const vendor = sql.indexOf('DELETE FROM "provider_cost_vendor_costs"');
    const costs = sql.indexOf('DELETE FROM "providers_costs"');
    expect(vendor).toBeGreaterThan(-1);
    expect(costs).toBeGreaterThan(vendor);
    expect(sql).toContain(`DELETE FROM "platform_costs" WHERE "provider" IN ('cerebras', 'groq')`);
  });
});
