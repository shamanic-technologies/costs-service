import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  DEEPSEEK_TIME_OF_DAY_PRICING_FROM,
  DEEPSEEK_PEAK_HOURS_UTC,
  DEEPSEEK_OFF_PEAK_HOURS_UTC,
  applyCostRiskMultiplier,
  withChinaVat,
  type SeedProviderCost,
} from "../../src/db/seed.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Monday-indexed, matching DAY_NAMES. */
const WEEKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];

/**
 * Parse "Mon-Fri@01:00-04:00,Sat-Sun@00:00-24:00" into half-open windows over
 * (Monday-indexed day, minute of day).
 *
 * Deliberately a SEPARATE implementation from anything in src: the point of the test is that
 * the published string means what the catalog claims, so re-using a shared parser would only
 * prove the parser agrees with itself.
 */
function parseWindows(spec: string): Array<{ days: number[]; from: number; to: number }> {
  return spec.split(",").map((window) => {
    const [dayPart, hourPart] = window.split("@");
    if (hourPart === undefined) {
      throw new Error(`Window is missing its day scope: ${window}`);
    }
    const [firstDay, lastDay] = dayPart.split("-");
    const firstIdx = DAY_NAMES.indexOf(firstDay as (typeof DAY_NAMES)[number]);
    const lastIdx = DAY_NAMES.indexOf((lastDay ?? firstDay) as (typeof DAY_NAMES)[number]);
    if (firstIdx < 0 || lastIdx < 0 || lastIdx < firstIdx) {
      throw new Error(`Unparseable day scope: ${dayPart}`);
    }
    const days: number[] = [];
    for (let d = firstIdx; d <= lastIdx; d++) days.push(d);

    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const [from, to] = hourPart.split("-");
    return { days, from: toMinutes(from), to: toMinutes(to) };
  });
}

function covers(spec: string, day: number, minuteOfDay: number): boolean {
  return parseWindows(spec).some(
    (w) => w.days.includes(day) && minuteOfDay >= w.from && minuteOfDay < w.to,
  );
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

  it("partitions the whole WEEK between peak and off-peak — exactly one regime per minute", () => {
    // Totality is what makes the selection rule mechanical: a consumer never has to decide
    // what to do with a minute that matches both regimes or neither. Since 2026-08-23 the
    // regime depends on the weekday too, so totality is over (day, minute), not minute alone.
    for (let day = 0; day < 7; day++) {
      for (let minute = 0; minute < 24 * 60; minute++) {
        const matches = [DEEPSEEK_PEAK_HOURS_UTC, DEEPSEEK_OFF_PEAK_HOURS_UTC].filter((spec) =>
          covers(spec, day, minute),
        );
        expect(matches, `${DAY_NAMES[day]} minute ${minute}`).toHaveLength(1);
      }
    }
  });

  it("declares peak as 01:00-04:00 and 06:00-10:00 UTC on WEEKDAYS, off-peak as the complement", () => {
    expect(DEEPSEEK_PEAK_HOURS_UTC).toBe("Mon-Fri@01:00-04:00,Mon-Fri@06:00-10:00");
    expect(DEEPSEEK_OFF_PEAK_HOURS_UTC).toBe(
      "Mon-Fri@00:00-01:00,Mon-Fri@04:00-06:00,Mon-Fri@10:00-24:00,Sat-Sun@00:00-24:00",
    );
    for (const day of WEEKDAYS) {
      expect(covers(DEEPSEEK_PEAK_HOURS_UTC, day, 2 * 60), DAY_NAMES[day]).toBe(true); // 02:00 peak
      expect(covers(DEEPSEEK_PEAK_HOURS_UTC, day, 8 * 60), DAY_NAMES[day]).toBe(true); // 08:00 peak
      expect(covers(DEEPSEEK_PEAK_HOURS_UTC, day, 5 * 60), DAY_NAMES[day]).toBe(false); // 05:00 off-peak
      expect(covers(DEEPSEEK_OFF_PEAK_HOURS_UTC, day, 23 * 60 + 59), DAY_NAMES[day]).toBe(true);
    }
  });

  it("charges off-peak all weekend, at every minute of Saturday and Sunday", () => {
    // The vendor's 2026-08-23 rule, announced in the top-up console: "off-peak rates applying
    // throughout the day on weekends (Saturdays and Sundays, Beijing Time)". Every peak window
    // sits between 01:00 and 10:00 UTC, well inside the stretch of a UTC day that shares its
    // weekday with Beijing, so the Beijing weekend lands on whole UTC Saturdays and Sundays.
    // Before this, 02:00 and 08:00 on a weekend resolved to the peak name and the customer was
    // charged twice the rate DeepSeek actually billed us.
    for (const day of WEEKEND) {
      for (let minute = 0; minute < 24 * 60; minute++) {
        expect(covers(DEEPSEEK_PEAK_HOURS_UTC, day, minute), `${DAY_NAMES[day]} ${minute}`).toBe(
          false,
        );
        expect(
          covers(DEEPSEEK_OFF_PEAK_HOURS_UTC, day, minute),
          `${DAY_NAMES[day]} ${minute}`,
        ).toBe(true);
      }
    }
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
        for (let day = 0; day < 7; day++) {
          for (let hour = 0; hour < 24; hour++) {
            const matching = SEED_PROVIDERS_COSTS.filter(
              (c) =>
                c.provider === "deepseek" &&
                c.name.startsWith(`${model}-`) &&
                c.name.endsWith(`-${tokenClass}`) &&
                c.pricingRegime !== undefined &&
                covers(c.regimeHoursUtc!, day, hour * 60),
            );
            // Two price points (pre-schedule + scheduled) of ONE name.
            expect(
              new Set(matching.map((c) => c.name)).size,
              `${model} ${tokenClass} ${DAY_NAMES[day]}@${hour}h`,
            ).toBe(1);
          }
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
          expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(withChinaVat(raw)));
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
      expect(row.costPerUnitInUsdCents, name).toBe(applyCostRiskMultiplier(withChinaVat(raw)));
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
