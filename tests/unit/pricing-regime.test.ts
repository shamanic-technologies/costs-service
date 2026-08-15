import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  DEEPSEEK_TIME_OF_DAY_PRICING_FROM,
  DEEPSEEK_PEAK_HOURS_UTC,
  DEEPSEEK_OFF_PEAK_HOURS_UTC,
  applyCostRiskMultiplier,
  type SeedProviderCost,
} from "../../src/db/seed.js";

/** Parse "01:00-04:00,06:00-10:00" into half-open [startMinute, endMinute) ranges. */
function parseWindows(spec: string): Array<[number, number]> {
  return spec.split(",").map((range) => {
    const [from, to] = range.split("-");
    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    return [toMinutes(from), toMinutes(to)] as [number, number];
  });
}

function covers(spec: string, minuteOfDay: number): boolean {
  return parseWindows(spec).some(([from, to]) => minuteOfDay >= from && minuteOfDay < to);
}

const PRE_SCHEDULE = "2025-01-01T00:00:00.000Z";
const SCHEDULE_START = "2026-08-16T16:00:00.000Z";

function version(name: string, effectiveFrom: string): SeedProviderCost {
  const row = SEED_PROVIDERS_COSTS.find(
    (c) => c.name === name && c.effectiveFrom.toISOString() === effectiveFrom,
  );
  expect(row, `${name} @ ${effectiveFrom}`).toBeDefined();
  return row!;
}

describe("Pricing regime — the priced dimension that is a property of the moment", () => {
  it("starts DeepSeek time-of-day pricing at the vendor's announced instant", () => {
    // https://api-docs.deepseek.com/quick_start/pricing — "Effective August 16, 2026 at 16:00 UTC"
    expect(DEEPSEEK_TIME_OF_DAY_PRICING_FROM.toISOString()).toBe(SCHEDULE_START);
  });

  it("partitions the UTC day between peak and off-peak — exactly one regime per minute", () => {
    // Totality is what makes the selection rule mechanical: a consumer never has to decide
    // what to do with a minute that matches both regimes or neither.
    for (let minute = 0; minute < 24 * 60; minute++) {
      const matches = [DEEPSEEK_PEAK_HOURS_UTC, DEEPSEEK_OFF_PEAK_HOURS_UTC].filter((spec) =>
        covers(spec, minute),
      );
      expect(matches, `minute ${minute} of the UTC day`).toHaveLength(1);
    }
  });

  it("declares peak as 01:00-04:00 and 06:00-10:00 UTC, off-peak as the complement", () => {
    expect(DEEPSEEK_PEAK_HOURS_UTC).toBe("01:00-04:00,06:00-10:00");
    expect(DEEPSEEK_OFF_PEAK_HOURS_UTC).toBe("00:00-01:00,04:00-06:00,10:00-24:00");
    expect(covers(DEEPSEEK_PEAK_HOURS_UTC, 2 * 60)).toBe(true); // 02:00 peak
    expect(covers(DEEPSEEK_PEAK_HOURS_UTC, 5 * 60)).toBe(false); // 05:00 off-peak
    expect(covers(DEEPSEEK_OFF_PEAK_HOURS_UTC, 23 * 60 + 59)).toBe(true);
  });

  it("carries the regime windows on every regime-priced row, and on no other row", () => {
    for (const row of SEED_PROVIDERS_COSTS) {
      if (row.pricingRegime === undefined) {
        expect(row.regimeHoursUtc, row.name).toBeUndefined();
        continue;
      }
      expect(["peak", "off-peak"]).toContain(row.pricingRegime);
      expect(row.regimeHoursUtc, row.name).toBe(
        row.pricingRegime === "peak" ? DEEPSEEK_PEAK_HOURS_UTC : DEEPSEEK_OFF_PEAK_HOURS_UTC,
      );
      // The name must agree with the column, or a consumer picking by name gets a rate that
      // applies at a different hour than it thinks.
      expect(row.name).toContain(`-${row.pricingRegime}-tokens-`);
    }
  });

  it("gives every (model, token class, instant) exactly one cost name", () => {
    for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
      for (const tokenClass of ["tokens-input", "tokens-cached-input", "tokens-output"]) {
        for (let hour = 0; hour < 24; hour++) {
          const matching = SEED_PROVIDERS_COSTS.filter(
            (c) =>
              c.provider === "deepseek" &&
              c.name.startsWith(`${model}-`) &&
              c.name.endsWith(`-${tokenClass}`) &&
              c.pricingRegime !== undefined &&
              covers(c.regimeHoursUtc!, hour * 60),
          );
          // Two price points (pre-schedule + scheduled) of ONE name.
          expect(new Set(matching.map((c) => c.name)).size, `${model} ${tokenClass} @${hour}h`).toBe(1);
        }
      }
    }
  });

  it("prices the pre-schedule version of both regimes at the vendor's current uniform rate", () => {
    // Time-of-day pricing is not live before 2026-08-16T16:00Z, so DeepSeek charges the same
    // at every hour — both regimes carry that rate, read from the vendor's current table.
    const current = {
      "deepseek-v4-flash": {
        "tokens-input": "0.0000140000",
        "tokens-cached-input": "0.0000002800",
        "tokens-output": "0.0000280000",
      },
      "deepseek-v4-pro": {
        "tokens-input": "0.0000435000",
        "tokens-cached-input": "0.0000003625",
        "tokens-output": "0.0000870000",
      },
    } as const;

    for (const [model, classes] of Object.entries(current)) {
      for (const [tokenClass, raw] of Object.entries(classes)) {
        for (const regime of ["peak", "off-peak"]) {
          const row = version(`${model}-${regime}-${tokenClass}`, PRE_SCHEDULE);
          expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(raw));
        }
      }
    }
  });

  it("prices the scheduled version at the vendor's peak and off-peak tables", () => {
    // https://api-docs.deepseek.com/quick_start/pricing, "Effective August 16, 2026 at 16:00 UTC".
    const scheduled = {
      "deepseek-v4-flash-peak-tokens-input": "0.0000440000", // $0.44/MTok
      "deepseek-v4-flash-peak-tokens-cached-input": "0.0000014000", // $0.014/MTok
      "deepseek-v4-flash-peak-tokens-output": "0.0001320000", // $1.32/MTok
      "deepseek-v4-flash-off-peak-tokens-input": "0.0000220000", // $0.22/MTok
      "deepseek-v4-flash-off-peak-tokens-cached-input": "0.0000007000", // $0.007/MTok
      "deepseek-v4-flash-off-peak-tokens-output": "0.0000660000", // $0.66/MTok
      "deepseek-v4-pro-peak-tokens-input": "0.0001320000", // $1.32/MTok
      "deepseek-v4-pro-peak-tokens-cached-input": "0.0000044000", // $0.044/MTok
      "deepseek-v4-pro-peak-tokens-output": "0.0003960000", // $3.96/MTok
      "deepseek-v4-pro-off-peak-tokens-input": "0.0000660000", // $0.66/MTok
      "deepseek-v4-pro-off-peak-tokens-cached-input": "0.0000022000", // $0.022/MTok
      "deepseek-v4-pro-off-peak-tokens-output": "0.0001980000", // $1.98/MTok
    };

    for (const [name, raw] of Object.entries(scheduled)) {
      const row = version(name, SCHEDULE_START);
      expect(row.costPerUnitInUsdCents, name).toBe(applyCostRiskMultiplier(raw));
    }
  });

  it("keeps the scheduled change additive — the pre-schedule version is untouched", () => {
    // Append-only: a scheduled price point must not replace the version it supersedes, or
    // costs already declared would be re-priced.
    for (const regime of ["peak", "off-peak"]) {
      const versions = SEED_PROVIDERS_COSTS.filter(
        (c) => c.name === `deepseek-v4-flash-${regime}-tokens-input`,
      );
      expect(versions).toHaveLength(2);
      expect(versions.map((c) => c.effectiveFrom.toISOString()).sort()).toEqual([
        PRE_SCHEDULE,
        SCHEDULE_START,
      ]);
    }
  });

  it("leaves the superseded regime-free DeepSeek names frozen at their old price", () => {
    // They cannot be re-priced: after the schedule starts DeepSeek has no regime-free rate,
    // so any value appended to them would be invented.
    for (const name of [
      "deepseek-v4-flash-tokens-input",
      "deepseek-v4-flash-tokens-output",
      "deepseek-v4-pro-tokens-input",
      "deepseek-v4-pro-tokens-output",
    ]) {
      const versions = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
      expect(versions, name).toHaveLength(1);
      expect(versions[0].pricingRegime).toBeUndefined();
    }
  });

  it("leaves every non-DeepSeek cost regime-free", () => {
    const regimed = SEED_PROVIDERS_COSTS.filter((c) => c.pricingRegime !== undefined);
    expect(new Set(regimed.map((c) => c.provider))).toEqual(new Set(["deepseek"]));
    expect(regimed).toHaveLength(24); // 2 models × 2 regimes × 3 token classes × 2 versions
  });

  it("keeps a single price point per (name, plan, cycle, effective_from)", () => {
    // The DB unique index; a duplicate here would make the seed insert fail at boot.
    const keys = SEED_PROVIDERS_COSTS.map(
      (c) => `${c.name}|${c.planTier}|${c.billingCycle}|${c.effectiveFrom.toISOString()}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
