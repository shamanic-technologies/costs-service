import { describe, it, expect } from "vitest";
import { matchVendors, paidFromAccounts, providerNames, type LedgerVendor } from "../../src/lib/ledger.js";

function vendor(key: string, accounts: Array<[string, string]>): LedgerVendor {
  return {
    key,
    name: key,
    lastPaidOn: accounts.map((a) => a[1]).sort().at(-1)!,
    paidFrom: accounts.map(([accountId, lastPaidOn]) => ({
      accountId,
      label: accountId,
      institutionDomain: null,
      scope: "business",
      connector: "qonto",
      lastPaidOn,
    })),
  };
}

const CATALOGUE = [
  { provider: "anthropic", providerDomain: "anthropic.com" },
  { provider: "google", providerDomain: "google.com" },
  { provider: "google-ads", providerDomain: "ads.google.com" },
  { provider: "instantly", providerDomain: "instantly.ai" },
  { provider: "serper-dev", providerDomain: "serper.dev" },
  { provider: "x-ads", providerDomain: "x.com" },
  { provider: "zai", providerDomain: "z.ai" },
  { provider: "creator-sponsorship", providerDomain: null },
];

describe("matching catalogue providers to bank-ledger vendors", () => {
  it("names a provider by its key, its domain and its domain label", () => {
    expect(providerNames("instantly", "instantly.ai")).toEqual([["instantly"], ["instantly", "ai"]]);
    expect(providerNames("google-ads", "ads.google.com")).toEqual([["google", "ads"], ["ads", "google", "com"], ["ads", "google"]]);
  });

  it("joins a vendor key that starts with the provider's name, word for word", () => {
    const m = matchVendors(CATALOGUE, [
      vendor("anthropic", [["qonto-1", "2026-09-12"]]),
      vendor("instantly ai", [["rev-biz", "2026-09-01"]]),
      vendor("serper dev", [["rev-biz", "2026-08-01"]]),
      vendor("zai", [["rev-biz", "2026-08-02"]]),
    ]);
    expect(m.get("anthropic")!.map((v) => v.key)).toEqual(["anthropic"]);
    expect(m.get("instantly")!.map((v) => v.key)).toEqual(["instantly ai"]);
    expect(m.get("serper-dev")!.map((v) => v.key)).toEqual(["serper dev"]);
    expect(m.get("zai")!.map((v) => v.key)).toEqual(["zai"]);
  });

  it("gives a vendor to the LONGEST matching name (google ads -> google-ads, google cloud -> google)", () => {
    const m = matchVendors(CATALOGUE, [vendor("google ads", [["a", "2026-09-01"]]), vendor("google cloud", [["a", "2026-09-02"]])]);
    expect(m.get("google-ads")!.map((v) => v.key)).toEqual(["google ads"]);
    expect(m.get("google")!.map((v) => v.key)).toEqual(["google cloud"]);
  });

  it("falls back to whole words inside the key for a reseller line, always below a prefix fit", () => {
    const m = matchVendors(
      [...CATALOGUE, { provider: "youtube-ads", providerDomain: "youtube.com" }],
      [vendor("paddle net serper", [["q", "2026-05-22"]]), vendor("google youtube", [["q", "2026-06-25"]])],
    );
    expect(m.get("serper-dev")!.map((v) => v.key)).toEqual(["paddle net serper"]);
    expect(m.get("google")!.map((v) => v.key)).toEqual(["google youtube"]);
    expect(m.get("youtube-ads")).toEqual([]);
  });

  it("never matches a prefix inside a word, a single-letter name, or a provider without a match", () => {
    const m = matchVendors(CATALOGUE, [
      vendor("anthropics llc", [["a", "2026-09-01"]]),
      vendor("ads manager", [["a", "2026-09-01"]]),
      vendor("instant gaming", [["a", "2026-09-01"]]),
    ]);
    for (const p of CATALOGUE) expect(m.get(p.provider)).toEqual([]);
  });

  it("attaches a vendor two providers fit equally to neither", () => {
    const m = matchVendors(
      [{ provider: "acme", providerDomain: "acme.io" }, { provider: "acme-io", providerDomain: null }, { provider: "acme-labs", providerDomain: "acme.com" }],
      [vendor("acme", [["a", "2026-09-01"]])],
    );
    // "acme" fits acme (key) and acme-labs (domain label "acme"), both one word long.
    expect(m.get("acme")).toEqual([]);
    expect(m.get("acme-labs")).toEqual([]);
  });

  it("collapses accounts across matched vendors to each account's latest payment, most recent first", () => {
    const accounts = paidFromAccounts([
      vendor("google ads", [["rev-biz", "2026-07-01"], ["qonto", "2026-09-01"]]),
      vendor("google ads ireland", [["rev-biz", "2026-09-20"]]),
    ]);
    expect(accounts.map((a) => [a.accountId, a.lastPaidOn])).toEqual([["rev-biz", "2026-09-20"], ["qonto", "2026-09-01"]]);
  });
});
