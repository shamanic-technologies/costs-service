import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  CHINA_VAT_MULTIPLIER,
  applyCostRiskMultiplier,
  withChinaVat,
} from "../../src/db/seed.js";

/**
 * DeepSeek's published price is not what we pay. Every top-up carries 6% Chinese VAT
 * (a $5.00 top-up is charged as $5.30), and Chinese VAT cannot be reclaimed through an EU
 * VAT return — so it is spend, not an advance. It therefore belongs in the vendor basis,
 * underneath the store markup, not folded into the markup itself.
 *
 * Z.ai and Moonshot are the control group: also Chinese vendors, and their invoices carry
 * no VAT line. The test asserts the asymmetry deliberately, so that a future reader who
 * notices "three Chinese vendors, one multiplier" finds a decision here rather than what
 * looks like an oversight and 'fixes' it.
 */
describe("Chinese VAT on the DeepSeek vendor basis", () => {
  it("raises a published rate by exactly 6%, rounding half-up to 10 decimals", () => {
    expect(CHINA_VAT_MULTIPLIER).toBe(1.06);
    expect(withChinaVat("0.0000140000")).toBe("0.0000148400"); // $0.14/MTok -> $0.1484
    expect(withChinaVat("1.0000000000")).toBe("1.0600000000");
    // 3625 x 1.06 = 3842.5 at the 10th decimal, the one cell that is not exact.
    expect(withChinaVat("0.0000003625")).toBe("0.0000003843");
  });

  it("refuses a value that is not a fixed 10-decimal cost string", () => {
    // Same guard as the markup path: a malformed literal must not silently become a price.
    expect(() => withChinaVat("0.14")).toThrow(/Invalid seed cost format/);
    expect(() => withChinaVat("abc")).toThrow(/Invalid seed cost format/);
  });

  it("prices every DeepSeek regime row as vendor cell -> VAT -> markup", () => {
    // The vendor's own tables, https://api-docs.deepseek.com/quick_start/pricing (2026-08-15).
    // Quoted verbatim here for the same reason the seed quotes them: the published cell is
    // the auditable fact, and everything after it is our arithmetic.
    const vendor: Record<string, string> = {
      "deepseek-v4-flash-peak-tokens-input": "0.0000440000",
      "deepseek-v4-flash-peak-tokens-cached-input": "0.0000014000",
      "deepseek-v4-flash-peak-tokens-output": "0.0001320000",
      "deepseek-v4-flash-off-peak-tokens-input": "0.0000220000",
      "deepseek-v4-flash-off-peak-tokens-cached-input": "0.0000007000",
      "deepseek-v4-flash-off-peak-tokens-output": "0.0000660000",
      "deepseek-v4-pro-peak-tokens-input": "0.0001320000",
      "deepseek-v4-pro-peak-tokens-cached-input": "0.0000044000",
      "deepseek-v4-pro-peak-tokens-output": "0.0003960000",
      "deepseek-v4-pro-off-peak-tokens-input": "0.0000660000",
      "deepseek-v4-pro-off-peak-tokens-cached-input": "0.0000022000",
      "deepseek-v4-pro-off-peak-tokens-output": "0.0001980000",
    };

    for (const [name, cell] of Object.entries(vendor)) {
      const row = SEED_PROVIDERS_COSTS.find(
        (c) => c.name === name && c.effectiveFrom.toISOString() === "2026-08-16T16:00:00.000Z",
      );
      expect(row, name).toBeDefined();
      expect(row!.costPerUnitInUsdCents, name).toBe(applyCostRiskMultiplier(withChinaVat(cell)));
      // And it is genuinely dearer than the un-VAT'd figure — otherwise this test would still
      // pass if withChinaVat ever became the identity.
      expect(row!.costPerUnitInUsdCents, name).not.toBe(applyCostRiskMultiplier(cell));
    }
  });

  it("charges the VAT under the markup, not on top of it", () => {
    // Order matters at the 10th decimal, and the order encodes the reasoning: VAT is part of
    // what the call costs us, so the store margin is taken on the VAT-inclusive cost.
    const row = SEED_PROVIDERS_COSTS.find(
      (c) =>
        c.name === "deepseek-v4-pro-off-peak-tokens-cached-input" &&
        c.effectiveFrom.toISOString() === "2025-01-01T00:00:00.000Z",
    )!;
    expect(row.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier(withChinaVat("0.0000003625")));
    expect(row.costPerUnitInUsdCents).toBe("0.0000019215");
    // Marking up first and VAT-ing the result rounds differently, and would mean charging our
    // own margin the vendor's tax.
    expect(row.costPerUnitInUsdCents).not.toBe(withChinaVat(applyCostRiskMultiplier("0.0000003625")));
  });

  it("leaves the frozen regime-free DeepSeek names at their un-VAT'd price", () => {
    // These were superseded when time-of-day pricing started and carry no new version. A VAT
    // correction is a new price version, so applying one here would re-price spend already
    // declared against a name the vendor no longer quotes a rate for.
    const frozen: Record<string, string> = {
      "deepseek-v4-flash-tokens-input": "0.0000140000",
      "deepseek-v4-flash-tokens-output": "0.0000280000",
      "deepseek-v4-pro-tokens-input": "0.0000435000",
      "deepseek-v4-pro-tokens-output": "0.0000870000",
    };
    for (const [name, cell] of Object.entries(frozen)) {
      const versions = SEED_PROVIDERS_COSTS.filter((c) => c.name === name);
      expect(versions, name).toHaveLength(1);
      expect(versions[0].costPerUnitInUsdCents, name).toBe(applyCostRiskMultiplier(cell));
    }
  });

  it("applies no VAT to Z.ai or Moonshot — their invoices carry none", () => {
    // The test is the invoice, not the vendor's nationality. If one of these ever starts
    // billing VAT, that is a new price version on those names, decided from an invoice.
    const unVatted: Record<string, string> = {
      "zai-glm-5.2-tokens-input": "0.0001400000",
      "zai-glm-5.2-tokens-output": "0.0004400000",
      "moonshot-kimi-k3-tokens-input": "0.0003000000",
      "moonshot-kimi-k3-tokens-output": "0.0015000000",
    };
    for (const [name, cell] of Object.entries(unVatted)) {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === name);
      expect(row, name).toBeDefined();
      expect(row!.costPerUnitInUsdCents, name).toBe(applyCostRiskMultiplier(cell));
    }
  });

  it("marks up only DeepSeek by the VAT — no other provider's rows move", () => {
    const vatted = SEED_PROVIDERS_COSTS.filter((c) => c.pricingRegime !== undefined);
    expect(new Set(vatted.map((c) => c.provider))).toEqual(new Set(["deepseek"]));
  });
});
