import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  DEEPSEEK_PEAK_HOURS_UTC,
  DEEPSEEK_OFF_PEAK_HOURS_UTC,
  DEEPSEEK_V4_1_FLASH_PRICING_FROM,
  applyCostRiskMultiplier,
  withChinaVat,
} from "../../src/db/seed.js";

// DeepSeek V4.1 Flash, released 2026-09-10, priced from 04:00 UTC that day.
// Vendor cells, per 1M tokens (announcement of 2026-09-10, confirmed against
// https://api-docs.deepseek.com/quick_start/pricing):
//
//   off-peak | peak
//     cache hit   $0.003  | $0.006
//     cache miss  $0.15   | $0.3
//     output      $0.6    | $1.2
//
// Converted to cents per token by ÷10⁴.
const VENDOR = {
  "deepseek-v4.1-flash-peak-tokens-input": "0.0000300000",
  "deepseek-v4.1-flash-peak-tokens-cached-input": "0.0000006000",
  "deepseek-v4.1-flash-peak-tokens-output": "0.0001200000",
  "deepseek-v4.1-flash-off-peak-tokens-input": "0.0000150000",
  "deepseek-v4.1-flash-off-peak-tokens-cached-input": "0.0000003000",
  "deepseek-v4.1-flash-off-peak-tokens-output": "0.0000600000",
} as const;

const rows = (name: string) => SEED_PROVIDERS_COSTS.filter((c) => c.name === name);

describe("DeepSeek V4.1 Flash unit costs", () => {
  it("prices every (regime, token class) at the vendor's published cell, VAT then markup", () => {
    for (const [name, raw] of Object.entries(VENDOR)) {
      const versions = rows(name);
      expect(versions, name).toHaveLength(1);
      expect(versions[0].costPerUnitInUsdCents, name).toBe(
        applyCostRiskMultiplier(withChinaVat(raw)),
      );
      expect(versions[0].provider, name).toBe("deepseek");
      expect(versions[0].providerDomain, name).toBe("deepseek.com");
      expect(versions[0].unit, name).toBe("1M tokens");
      expect(versions[0].pricingBasis, name).toBe("marked-up");
    }
  });

  it("takes effect at the instant the vendor states, not at boot", () => {
    // A cost declared before 2026-09-10T04:00Z must resolve to whatever was in force then —
    // dating this row `now()` would back-date a price to before the model existed.
    expect(DEEPSEEK_V4_1_FLASH_PRICING_FROM.toISOString()).toBe("2026-09-10T04:00:00.000Z");
    for (const name of Object.keys(VENDOR)) {
      expect(rows(name)[0].effectiveFrom.toISOString(), name).toBe("2026-09-10T04:00:00.000Z");
    }
  });

  it("carries no pre-schedule version — the model never had a regime-free rate", () => {
    // V4 Flash and V4 Pro each carry a 2025-01-01 uniform version because DeepSeek did charge
    // one rate at every hour before 2026-08-16T16:00Z. V4.1 Flash did not exist then.
    const v41 = SEED_PROVIDERS_COSTS.filter((c) => c.name.startsWith("deepseek-v4.1-flash-"));
    expect(v41).toHaveLength(6);
    expect(v41.every((c) => c.pricingRegime !== undefined)).toBe(true);
    expect(
      v41.some((c) => c.effectiveFrom.toISOString() === "2025-01-01T00:00:00.000Z"),
    ).toBe(false);
  });

  it("reuses DeepSeek's unchanged peak/off-peak windows", () => {
    for (const name of Object.keys(VENDOR)) {
      const row = rows(name)[0];
      const regime = name.includes("-off-peak-") ? "off-peak" : "peak";
      expect(row.pricingRegime, name).toBe(regime);
      expect(row.regimeHoursUtc, name).toBe(
        regime === "peak" ? DEEPSEEK_PEAK_HOURS_UTC : DEEPSEEK_OFF_PEAK_HOURS_UTC,
      );
    }
  });

  it("is a NEW model, not a re-price of V4 Flash — every V4 Flash row is untouched", () => {
    // V4.1 Flash's peak cache-miss input is $0.3/1M against V4 Flash's $0.44/1M. Appending
    // that to the V4 Flash names would re-price spend already declared against them.
    const v4 = applyCostRiskMultiplier(withChinaVat("0.0000440000"));
    const v41 = rows("deepseek-v4.1-flash-peak-tokens-input")[0].costPerUnitInUsdCents;
    expect(v41).not.toBe(v4);
    expect(Number(v41)).toBeLessThan(Number(v4));

    // The V4 Flash and V4 Pro rows keep their two versions each, at their own values.
    for (const regime of ["peak", "off-peak"]) {
      for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
        expect(rows(`${model}-${regime}-tokens-input`), model).toHaveLength(2);
      }
    }
    expect(rows("deepseek-v4-pro-peak-tokens-output")[1].costPerUnitInUsdCents).toBe(
      applyCostRiskMultiplier(withChinaVat("0.0003960000")),
    );
  });

  it("resolves against the active deepseek platform cost (plan_tier + billing_cycle match)", () => {
    // A mismatch 404s GET /v1/platform-prices/deepseek-v4.1-flash-*; a missing platform row 500s.
    const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "deepseek");
    expect(platform).toBeDefined();
    for (const name of Object.keys(VENDOR)) {
      const row = rows(name)[0];
      expect(row.planTier, name).toBe(platform!.planTier);
      expect(row.billingCycle, name).toBe(platform!.billingCycle);
    }
    expect(PROVIDER_DOMAINS.deepseek).toBe("deepseek.com");
  });

  it("labels each row with its model, token class and regime", () => {
    expect(rows("deepseek-v4.1-flash-peak-tokens-input")[0].type).toBe(
      "Input tokens (DeepSeek V4.1 Flash, cache miss, peak)",
    );
    expect(rows("deepseek-v4.1-flash-off-peak-tokens-cached-input")[0].type).toBe(
      "Cached input tokens (DeepSeek V4.1 Flash, off-peak)",
    );
    expect(rows("deepseek-v4.1-flash-off-peak-tokens-output")[0].type).toBe(
      "Output tokens (DeepSeek V4.1 Flash, off-peak)",
    );
  });
});
