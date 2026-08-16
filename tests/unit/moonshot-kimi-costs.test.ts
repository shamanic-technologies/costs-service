import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

// Vendor tables, per 1M tokens (USD):
//   https://platform.kimi.ai/docs/pricing/chat-k26 — K2.6: $0.95 miss / $0.16 hit / $4.00 out
//   https://platform.kimi.ai/docs/pricing/chat-k3  — K3:   $3.00 miss / $0.30 hit / $15.00 out
// (read 2026-08-16; platform.moonshot.ai/docs/pricing/* 301s to platform.kimi.ai)
const MOONSHOT_NAMES = [
  "moonshot-kimi-k2.6-tokens-input",
  "moonshot-kimi-k2.6-tokens-cached-input",
  "moonshot-kimi-k2.6-tokens-output",
  "moonshot-kimi-k3-tokens-input",
  "moonshot-kimi-k3-tokens-cached-input",
  "moonshot-kimi-k3-tokens-output",
];

describe("Moonshot Kimi unit costs (direct vendor)", () => {
  it("registers moonshot-kimi-k2.6-tokens-input at $0.95/1M uncached input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "moonshot-kimi-k2.6-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("moonshot");
    expect(row!.providerDomain).toBe("moonshot.ai");
    expect(row!.type).toBe("Input tokens (Kimi K2.6)");
    expect(row!.unit).toBe("1M tokens");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000950000"));
  });

  it("registers moonshot-kimi-k2.6-tokens-output at $4.00/1M output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "moonshot-kimi-k2.6-tokens-output");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Output tokens (Kimi K2.6)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0004000000"));
  });

  it("registers moonshot-kimi-k3-tokens-input at $3.00/1M uncached input tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "moonshot-kimi-k3-tokens-input");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("moonshot");
    expect(row!.type).toBe("Input tokens (Kimi K3)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0003000000"));
  });

  it("registers moonshot-kimi-k3-tokens-output at $15.00/1M output tokens", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "moonshot-kimi-k3-tokens-output");
    expect(row).toBeDefined();
    expect(row!.type).toBe("Output tokens (Kimi K3)");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0015000000"));
  });

  it("prices cached input on its own name, never blended into the uncached input rate", () => {
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "moonshot-kimi-k2.6-tokens-cached-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0000160000"));
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "moonshot-kimi-k3-tokens-cached-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0000300000"));

    // The uncached rows keep the uncached rate — blending would mis-price both modes.
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "moonshot-kimi-k2.6-tokens-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0000950000"));
    expect(
      SEED_PROVIDERS_COSTS.find((c) => c.name === "moonshot-kimi-k3-tokens-input")!
        .costPerUnitInUsdCents,
    ).toBe(applyCostRiskMultiplier("0.0003000000"));
  });

  it("carries no pricing regime — Moonshot publishes no time-of-day schedule", () => {
    for (const row of SEED_PROVIDERS_COSTS.filter((c) => c.provider === "moonshot")) {
      expect(row.pricingRegime).toBeUndefined();
      expect(row.regimeHoursUtc).toBeUndefined();
    }
  });

  it("resolves every row against the active moonshot platform cost (plan_tier + billing_cycle match)", () => {
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "moonshot");
    expect(platform).toBeDefined();
    // A mismatch would 404 GET /v1/platform-prices/moonshot-*, a missing platform row 500s.
    for (const name of MOONSHOT_NAMES) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name)!;
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    }
  });

  it("declares exactly one moonshot platform cost and a logo domain", () => {
    expect(SEED_PLATFORM_COSTS.filter((c) => c.provider === "moonshot")).toHaveLength(1);
    expect(PROVIDER_DOMAINS.moonshot).toBe("moonshot.ai");
  });

  it("names the rows byte-equal to chat-service's costPrefix for both Kimi aliases", () => {
    // chat-service resolves `kimi-flash` → costPrefix `moonshot-kimi-k2.6` and `kimi-pro` →
    // `moonshot-kimi-k3`, declaring `<costPrefix>-tokens-{input,cached-input,output}`.
    // A prefix the catalog does not carry is 422-rejected by runs-service at declaration.
    const rows = SEED_PROVIDERS_COSTS.filter((c) => c.provider === "moonshot").map((c) => c.name);
    expect(rows.sort()).toEqual([...MOONSHOT_NAMES].sort());
    for (const prefix of ["moonshot-kimi-k2.6", "moonshot-kimi-k3"]) {
      for (const suffix of ["-tokens-input", "-tokens-cached-input", "-tokens-output"]) {
        expect(rows).toContain(`${prefix}${suffix}`);
      }
    }
  });
});
