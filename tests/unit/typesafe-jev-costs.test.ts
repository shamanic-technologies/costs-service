import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Vendor table, from https://docs.typesafe.ai/models.md (read 2026-09-19):
//   Jev 1.13 (`jev-1.13.0`, aliases `jev-latest` / `jev-preview`) — $42 per Btok = $0.042 per
//   1M INPUT tokens. Verbatim: "Charged per input token. Output tokens are free." No cache-hit
//   dimension, no time-of-day schedule.
const INPUT_NAME = "typesafe-jev-1.13-tokens-input";

describe("TypeSafe Jev unit costs (new direct vendor)", () => {
  it("registers typesafe-jev-1.13-tokens-input at $0.042/1M input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === INPUT_NAME);
    expect(row).toBeDefined();
    expect(row!.provider).toBe("typesafe");
    expect(row!.providerDomain).toBe("typesafe.ai");
    expect(row!.type).toBe("Input tokens (Jev 1.13)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000042000"));
  });

  it("seeds NO output row — the vendor charges nothing for output tokens", () => {
    // A symmetric `-tokens-output` name would bill customers for something no invoice carries.
    // Same reasoning for `-tokens-cached-input`: the vendor publishes no cache-hit dimension,
    // so there is no rate to record.
    const names = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "typesafe").map((c) => c.name);
    expect(names).toEqual([INPUT_NAME]);
    expect(names.some((n) => n.endsWith("-tokens-output"))).toBe(false);
    expect(names.some((n) => n.endsWith("-tokens-cached-input"))).toBe(false);
  });

  it("marks the line marked-up — LLM tokens are work we perform, not money we route", () => {
    expect(SEED_PROVIDERS_COSTS.find((c) => c.name === INPUT_NAME)!.pricingBasis).toBe("marked-up");
  });

  it("carries no pricing regime — TypeSafe publishes no time-of-day schedule", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === INPUT_NAME)!;
    expect(row.pricingRegime).toBeUndefined();
    expect(row.regimeHoursUtc).toBeUndefined();
  });

  it("keys the name on the release, never on a moving alias", () => {
    // `jev-latest` / `jev-preview` both resolve to `jev-1.13.0` today and move without notice;
    // a name carrying an alias would silently reprice when they do.
    for (const alias of ["latest", "preview"]) {
      expect(SEED_PROVIDERS_COSTS.some((c) => c.name.includes(`jev-${alias}`))).toBe(false);
    }
  });

  it("declares a typesafe platform cost, so the first-ever TypeSafe declaration resolves", () => {
    // Without this row the by-name read 500s `No platform cost configured for provider
    // 'typesafe'` — a cost row alone is not enough for a brand-new provider.
    const platform = SEED_PLATFORM_COSTS.filter((c) => c.provider === "typesafe");
    expect(platform).toHaveLength(1);
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === INPUT_NAME)!;
    expect(row.planTier).toBe(platform[0].planTier);
    expect(row.billingCycle).toBe(platform[0].billingCycle);
  });

  it("maps typesafe to a logo domain for the public pricing page", () => {
    expect(PROVIDER_DOMAINS.typesafe).toBe("typesafe.ai");
  });

  it("declares the name exactly once — no second version competing with the launch price", () => {
    expect(SEED_PROVIDERS_COSTS.filter((c) => c.name === INPUT_NAME)).toHaveLength(1);
  });
});
