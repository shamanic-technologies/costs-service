import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS, SEED_PLATFORM_COSTS } from "../../src/db/seed.js";

// chat-service turns Anthropic prompt caching on (2026-10-04) and must declare every token
// Anthropic bills. A 5-minute cache write is billed at 1.25x the model's base input price
// (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-10-04:
// Fable 5.1 $12.50, Sonnet 5.5 $2.50, Opus 5.5 $5 per MTok). Without these names chat-service
// fails loud on an unpriced cost name and cannot send cache_control.
const MODELS = [
  { model: "fable-5.1", label: "Fable 5.1" },
  { model: "sonnet-5.5", label: "Sonnet 5.5" },
  { model: "opus-5.5", label: "Opus 5.5" },
];

const find = (name: string) => SEED_PROVIDERS_COSTS.filter((c) => c.name === name);

describe("Anthropic 5-minute cache-write unit costs", () => {
  for (const { model, label } of MODELS) {
    const name = `anthropic-${model}-tokens-cache-write-5m`;

    it(`prices ${name} at exactly 1.25x the model's base input row`, () => {
      const rows = find(name);
      expect(rows).toHaveLength(1);
      const input = find(`anthropic-${model}-tokens-input`);
      expect(input).toHaveLength(1);
      // Exact decimal compare in integer units of 1e-10 cents (the column's scale).
      const scaled = (v: string) => BigInt(v.replace(".", ""));
      expect(scaled(rows[0].costPerUnitInUsdCents!) * 4n).toBe(scaled(input[0].costPerUnitInUsdCents!) * 5n);
    });

    it(`declares ${name} with the sibling rows' metadata and an active platform plan`, () => {
      const row = find(name)[0];
      const input = find(`anthropic-${model}-tokens-input`)[0];
      expect(row.type).toBe(`Cache write tokens, 5-minute TTL (${label})`);
      expect(row.provider).toBe("anthropic");
      expect(row.providerDomain).toBe(input.providerDomain);
      expect(row.unit).toBe("1M tokens");
      expect(row.pricingBasis).toBe("marked-up");
      expect([row.planTier, row.billingCycle]).toEqual([input.planTier, input.billingCycle]);
      const plan = SEED_PLATFORM_COSTS.find(
        (p) => p.provider === "anthropic" && p.planTier === row.planTier && p.billingCycle === row.billingCycle,
      );
      expect(plan).toBeDefined();
    });
  }
});
