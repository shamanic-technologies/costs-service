import { describe, it, expect } from "vitest";
import { SEED_PROVIDERS_COSTS } from "../../src/db/seed.js";
import { RETIRED_COST_NAMES, costNameStatus } from "../../src/lib/retired-cost-names.js";
import { EMAIL_SEND_COST_SHARES, LEGACY_COST_NAMES } from "../../src/lib/price-lists.js";
import { SUBSCRIPTIONS } from "../../src/lib/subscriptions.js";

const seeded = new Set(SEED_PROVIDERS_COSTS.map((c) => c.name));
// Names the catalogue carries without a seed entry: the proposed-list sync gives them a version.
const syncedNames = new Set([
  ...Object.keys(EMAIL_SEND_COST_SHARES),
  ...Object.keys(LEGACY_COST_NAMES),
  ...SUBSCRIPTIONS.flatMap((s) => [...s.creditCostNames, ...s.excludedCostNames.map((e) => e.costName)]),
]);

describe("retired cost names (public price list status)", () => {
  it("every retired name is a name the catalogue actually carries", () => {
    const unknown = Object.keys(RETIRED_COST_NAMES).filter((n) => !seeded.has(n) && !syncedNames.has(n));
    expect(unknown).toEqual([]);
  });

  it("every successor is a seeded name that is itself current", () => {
    const bad = Object.entries(RETIRED_COST_NAMES).flatMap(([name, r]) =>
      r.supersededBy.filter((s) => !seeded.has(s) || costNameStatus(s).status !== "current").map((s) => `${name} -> ${s}`),
    );
    expect(bad).toEqual([]);
  });

  it("every legacy name priced as its successor is retired", () => {
    for (const [name, l] of Object.entries(LEGACY_COST_NAMES)) {
      expect(costNameStatus(name)).toEqual({ status: "retired", supersededBy: [l.successor] });
    }
  });

  it("instantly-email-send is retired, so it never shares the 'per account' email line with the current name (daegu-v2 report 2026-10-06)", () => {
    expect(costNameStatus("instantly-email-send")).toEqual({
      status: "retired",
      supersededBy: ["instantly-account-email-sent", "instantly-domain-email-sent"],
    });
    expect(costNameStatus("instantly-account-email-sent")).toEqual({ status: "current", supersededBy: null });
    expect(costNameStatus("instantly-domain-email-sent")).toEqual({ status: "current", supersededBy: null });
  });

  it("idle is not retired: lines still offered but unused for weeks stay current", () => {
    for (const name of [
      "google-flash-3.5-tokens-input", // selectable Gemini model
      "google-flash-3.6-tokens-input",
      "google-flash-3-tokens-input",
      "anthropic-web-search", // opt-in chat-service tool
      "google-search-query",
      "featured-api-pitch-submit",
      "serper-dev-query",
      "apify-pipelinelabs-lead",
      "google-embedding-001-tokens-input",
    ]) {
      expect(seeded.has(name)).toBe(true);
      expect(costNameStatus(name).status).toBe("current");
    }
  });

  it("DeepSeek V4 Flash and V4 Pro are retired in every token class and regime, each pointing at V4.1 Flash", () => {
    const v4 = [...seeded].filter((n) => /^deepseek-v4-(flash|pro)-/.test(n));
    expect(v4.length).toBeGreaterThan(0);
    for (const n of v4) {
      const s = costNameStatus(n);
      expect(s.status).toBe("retired");
      expect(s.supersededBy!.every((x) => x.startsWith("deepseek-v4.1-flash-"))).toBe(true);
    }
  });
});
