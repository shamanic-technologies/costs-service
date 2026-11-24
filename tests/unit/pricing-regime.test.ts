import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  DEEPSEEK_TIME_OF_DAY_PRICING_FROM,
  DEEPSEEK_PEAK_HOURS_UTC,
  DEEPSEEK_OFF_PEAK_HOURS_UTC,
  DEEPSEEK_WEEKDAY_PEAK_HOURS_UTC,
  DEEPSEEK_WEEKDAY_OFF_PEAK_HOURS_UTC,
  CHINA_PUBLIC_HOLIDAYS,
  applyCostRiskMultiplier,
  withChinaVat,
  type SeedProviderCost,
} from "../../src/db/seed.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Monday-indexed, matching DAY_NAMES. */
const WEEKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];

/**
 * Parse "Mon-Fri@01:00-04:00,!2027-10-01..2027-10-07@00:00-24:00" into half-open windows.
 * A scope is a weekday range, a UTC date, or an inclusive UTC date range; a leading `!`
 * makes the window an exclusion. An instant is covered when a plain window covers it and
 * no exclusion does.
 *
 * Deliberately a SEPARATE implementation from anything in src: the point of the test is that
 * the published string means what the catalog claims, so re-using a shared parser would only
 * prove the parser agrees with itself.
 */
type Window = {
  exclude: boolean;
  days?: number[];
  dateFrom?: string;
  dateTo?: string;
  from: number;
  to: number;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseWindows(spec: string): Window[] {
  return spec.split(",").map((raw) => {
    const exclude = raw.startsWith("!");
    const window = exclude ? raw.slice(1) : raw;
    const [scope, hourPart] = window.split("@");
    if (hourPart === undefined) {
      throw new Error(`Window is missing its scope: ${raw}`);
    }
    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const [from, to] = hourPart.split("-");
    const hours = { from: toMinutes(from), to: toMinutes(to) };

    if (DATE.test(scope.slice(0, 10))) {
      const [dateFrom, dateTo = dateFrom] = scope.split("..");
      if (!DATE.test(dateFrom) || !DATE.test(dateTo) || dateTo < dateFrom) {
        throw new Error(`Unparseable date scope: ${scope}`);
      }
      return { exclude, dateFrom, dateTo, ...hours };
    }
    const [firstDay, lastDay] = scope.split("-");
    const firstIdx = DAY_NAMES.indexOf(firstDay as (typeof DAY_NAMES)[number]);
    const lastIdx = DAY_NAMES.indexOf((lastDay ?? firstDay) as (typeof DAY_NAMES)[number]);
    if (firstIdx < 0 || lastIdx < 0 || lastIdx < firstIdx) {
      throw new Error(`Unparseable day scope: ${scope}`);
    }
    const days: number[] = [];
    for (let d = firstIdx; d <= lastIdx; d++) days.push(d);
    return { exclude, days, ...hours };
  });
}

const parsed = new Map<string, Window[]>();

/** Is the UTC instant inside the regime? */
function coversInstant(spec: string, at: Date): boolean {
  const day = (at.getUTCDay() + 6) % 7; // Monday-indexed
  const date = at.toISOString().slice(0, 10);
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  const hit = (w: Window) =>
    minute >= w.from &&
    minute < w.to &&
    (w.days ? w.days.includes(day) : date >= w.dateFrom! && date <= w.dateTo!);
  let windows = parsed.get(spec);
  if (!windows) parsed.set(spec, (windows = parseWindows(spec)));
  return windows.some((w) => !w.exclude && hit(w)) && !windows.some((w) => w.exclude && hit(w));
}

/** A Monday-indexed weekday of an ordinary week (2026-11-16 is a Monday with no holiday). */
function covers(spec: string, day: number, minuteOfDay: number): boolean {
  const at = new Date(Date.UTC(2026, 10, 16 + day, 0, minuteOfDay));
  return coversInstant(spec, at);
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
    expect(DEEPSEEK_PEAK_HOURS_UTC.startsWith("Mon-Fri@01:00-04:00,Mon-Fri@06:00-10:00,!")).toBe(true);
    expect(
      DEEPSEEK_OFF_PEAK_HOURS_UTC.startsWith(
        "Mon-Fri@00:00-01:00,Mon-Fri@04:00-06:00,Mon-Fri@10:00-24:00,Sat-Sun@00:00-24:00,",
      ),
    ).toBe(true);
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

  it("charges off-peak all day on a Chinese public holiday that falls on a weekday (DEEPSEEK-HOLIDAYS-1124)", () => {
    // DeepSeek's page (read 2026-11-24): peak is Mon-Fri "excluding Chinese public holidays",
    // off-peak covers "Chinese public holidays in full". Before this, 02:00 UTC on Thursday
    // 2026-10-01 (National Day) resolved to the peak name: the customer paid 2x what DeepSeek
    // billed us.
    const instants = [
      "2026-10-01T02:00:00Z", // Thu, National Day 2026, peak hour on an ordinary Thursday
      "2026-10-07T08:30:00Z", // Wed, last day of National Day 2026
      "2027-02-08T01:00:00Z", // Mon, Spring Festival 2027, first peak minute
      "2027-06-09T09:59:00Z", // Wed, Dragon Boat 2027 (one-day period), last peak minute
      "2027-09-15T06:00:00Z", // Wed, Mid-Autumn 2027
    ];
    for (const iso of instants) {
      const at = new Date(iso);
      expect(coversInstant(DEEPSEEK_PEAK_HOURS_UTC, at), iso).toBe(false);
      expect(coversInstant(DEEPSEEK_OFF_PEAK_HOURS_UTC, at), iso).toBe(true);
      // ...and the weekday-only windows the retired names keep would have said peak.
      expect(coversInstant(DEEPSEEK_WEEKDAY_PEAK_HOURS_UTC, at), iso).toBe(true);
    }
    // The make-up workday the notice moves onto a weekend stays off-peak (weekends in full).
    expect(coversInstant(DEEPSEEK_PEAK_HOURS_UTC, new Date("2027-10-09T02:00:00Z"))).toBe(false);
    // The working day right after a holiday is peak again.
    expect(coversInstant(DEEPSEEK_PEAK_HOURS_UTC, new Date("2026-10-08T02:00:00Z"))).toBe(true);
  });

  it("partitions every minute of 2026 and 2027 between peak and off-peak, holidays included", () => {
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2028, 0, 1);
    for (let t = start; t < end; t += 30 * 60_000) {
      // Every window edge sits on a whole hour, so half-hour steps visit both sides of each.
      const at = new Date(t);
      const n =
        Number(coversInstant(DEEPSEEK_PEAK_HOURS_UTC, at)) +
        Number(coversInstant(DEEPSEEK_OFF_PEAK_HOURS_UTC, at));
      if (n !== 1) expect(n, at.toISOString()).toBe(1);
    }
  });

  it("lists every holiday period exactly as the State Council notices state them", () => {
    // 国务院办公厅关于2026年 / 2027年部分节假日安排的通知 (news.cn, read 2026-11-24).
    expect(CHINA_PUBLIC_HOLIDAYS.map((h) => `${h.from}..${h.to}`)).toEqual([
      "2026-01-01..2026-01-03",
      "2026-02-15..2026-02-23",
      "2026-04-04..2026-04-06",
      "2026-05-01..2026-05-05",
      "2026-06-19..2026-06-21",
      "2026-09-25..2026-09-27",
      "2026-10-01..2026-10-07",
      "2027-01-01..2027-01-03",
      "2027-02-05..2027-02-13",
      "2027-04-03..2027-04-05",
      "2027-05-01..2027-05-05",
      "2027-06-09..2027-06-09",
      "2027-09-15..2027-09-15",
      "2027-10-01..2027-10-07",
    ]);
  });

  it("has the current year's Chinese holidays on record (add next year's each November)", () => {
    // Without them every weekday holiday of the year bills peak again, silently.
    const year = String(new Date().getUTCFullYear());
    expect(CHINA_PUBLIC_HOLIDAYS.some((h) => h.from.startsWith(year)), year).toBe(true);
  });

  it("carries the regime windows on every regime-priced row, and on no other row", () => {
    for (const row of SEED_PROVIDERS_COSTS) {
      if (row.pricingRegime === undefined) {
        expect(row.regimeHoursUtc, row.name).toBeUndefined();
        continue;
      }
      expect(["peak", "off-peak"]).toContain(row.pricingRegime);
      // The retired V4 Flash / V4 Pro names keep the weekday-only windows they were written with.
      const retired = /^deepseek-v4-(flash|pro)-/.test(row.name);
      const [peak, offPeak] = retired
        ? [DEEPSEEK_WEEKDAY_PEAK_HOURS_UTC, DEEPSEEK_WEEKDAY_OFF_PEAK_HOURS_UTC]
        : [DEEPSEEK_PEAK_HOURS_UTC, DEEPSEEK_OFF_PEAK_HOURS_UTC];
      expect(row.regimeHoursUtc, row.name).toBe(row.pricingRegime === "peak" ? peak : offPeak);
      // The name must agree with the column, or a consumer picking by name gets a rate that
      // applies at a different hour than it thinks.
      expect(row.name).toContain(`-${row.pricingRegime}-tokens-`);
    }
  });

  it("gives every (model, token class, instant) exactly one cost name", () => {
    for (const model of ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4.1-flash"]) {
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
    // 2 models × 2 regimes × 3 token classes × 2 versions, plus V4.1 Flash's
    // 2 regimes × 3 token classes × 1 version (it launched already regime-priced).
    expect(regimed).toHaveLength(30);
  });

  it("keeps a single price point per (name, plan, cycle, effective_from)", () => {
    // The DB unique index; a duplicate here would make the seed insert fail at boot.
    const keys = SEED_PROVIDERS_COSTS.map(
      (c) => `${c.name}|${c.planTier}|${c.billingCycle}|${c.effectiveFrom.toISOString()}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
