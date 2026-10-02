import { describe, it, expect } from "vitest";
import { CatalogueHistory, type CatalogueVersion } from "../../src/lib/catalogue-history.js";
import { catalogueTemplateName, planCatalogueSync, ZeroProposedPriceError, type ProposedItem } from "../../src/lib/catalogue-sync.js";

// The proposed price list becomes the billed catalogue price (owner go 2026-10-02).
const T0 = new Date("2025-01-01T00:00:00Z");
const NOW = new Date("2026-10-02T12:00:00Z");

const v = (name: string, provider: string, price: number | null, vendorCost: number | null, extra: Partial<CatalogueVersion> = {}): CatalogueVersion => ({
  id: `id-${name}`,
  name,
  provider,
  planTier: "p",
  billingCycle: "monthly",
  unit: "unit",
  pricingBasis: "marked-up",
  price,
  vendorCost,
  effectiveFrom: T0,
  createdAt: T0,
  ...extra,
});

const catalogue = new CatalogueHistory(
  [
    v("anthropic-sonnet-5.5-tokens-input", "anthropic", 0.001, 0.0002),
    v("apollo-credit", "apollo", 11.8, 2.36),
    v("instantly-account-email-sent", "instantly", null, null),
    v("instantly-contact-uploaded", "instantly", null, null),
    v("stripe-processing-fee", "stripe", 1, 1, { pricingBasis: "pass-through" }),
    v("google-flash-3-tokens-input", "google", 0.00025, 0.00005),
    v("hunter-credit", "hunter", 3, 0.6),
  ],
  ["anthropic", "apollo", "instantly", "stripe", "google", "hunter"].map((provider) => ({ provider, planTier: "p", billingCycle: "monthly", effectiveFrom: T0 })),
);

const item = (costName: string, proposed: string | null, extra: Partial<ProposedItem> = {}): ProposedItem => ({
  costName,
  method: "api-list-cost",
  flag: null,
  proposedBasis: "real-cost-x2",
  proposedPriceUsdCents: proposed,
  realCostUsdCents: null,
  ...extra,
});

describe("planCatalogueSync: the proposed list becomes the billed price", () => {
  it("writes a new version where the proposed price differs, carrying the vendor rate of the version it supersedes", () => {
    const plan = planCatalogueSync([item("anthropic-sonnet-5.5-tokens-input", "0.0004000000")], catalogue, NOW);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({
      costName: "anthropic-sonnet-5.5-tokens-input",
      templateName: null,
      priceUsdCents: "0.0004000000",
      previousPriceUsdCents: "0.0010000000",
      vendorCostUsdCents: "0.0002000000",
      vendorCostDerivation: "proposed-list",
    });
    expect(plan.writes[0].from.id).toBe("id-anthropic-sonnet-5.5-tokens-input");
  });

  it("writes nothing where the billed price already equals the proposed one (Stripe x1, idempotent re-run)", () => {
    const plan = planCatalogueSync([item("stripe-processing-fee", "1.0000000000", { method: "pass-through", proposedBasis: "real-cost-x1" })], catalogue, NOW);
    expect(plan).toEqual({ writes: [], kept: [], unchanged: 1 });
  });

  it("relists a delisted email line at its email-send-price share, its vendor cost being that real cost", () => {
    const plan = planCatalogueSync(
      [item("instantly-account-email-sent", "3.0519000000", { method: "email-send-price", realCostUsdCents: "1.5259500000" })],
      catalogue,
      NOW,
    );
    expect(plan.writes[0]).toMatchObject({ previousPriceUsdCents: null, priceUsdCents: "3.0519000000", vendorCostUsdCents: "1.5259500000", vendorCostDerivation: "proposed-list-real-cost" });
  });

  it("bills a unit included at the vendor at 0, explicitly (instantly-contact-uploaded): a declaring service is never refused", () => {
    const plan = planCatalogueSync(
      [item("instantly-contact-uploaded", "0.0000000000", { method: "included-at-vendor", flag: "included-in-another-cost", realCostUsdCents: "0.0000000000" })],
      catalogue,
      NOW,
    );
    expect(plan.writes[0]).toMatchObject({ priceUsdCents: "0.0000000000", vendorCostUsdCents: "0.0000000000" });
  });

  it("refuses the whole sync when any other item is proposed at 0: nothing silently becomes free", () => {
    expect(() => planCatalogueSync([item("anthropic-sonnet-5.5-tokens-input", "0.0000000000")], catalogue, NOW)).toThrow(ZeroProposedPriceError);
  });

  it("keeps the current price, flagged, where there is no proposed price or the list keeps it", () => {
    const plan = planCatalogueSync(
      [
        item("instantly-account-email-sent", null, { proposedBasis: "no-price", flag: "no-email-sent-yet" }),
        item("hunter-credit", "3.0000000000", { proposedBasis: "current-price-kept", flag: "no-real-cost-per-credit", method: "catalogue-vendor-cost" }),
      ],
      catalogue,
      NOW,
    );
    expect(plan.writes).toEqual([]);
    expect(plan.unchanged).toBe(1);
    expect(plan.kept.map((k) => [k.costName, k.billedPriceUsdCents])).toEqual([
      ["instantly-account-email-sent", null],
      ["hunter-credit", "3.0000000000"],
    ]);
  });

  it("gives a name the catalogue never carried its first version, copied from a catalogued name of its family", () => {
    const plan = planCatalogueSync(
      [
        item("apollo-enrichment-credit", "5.7178980000", { method: "subscription" }),
        item("gemini-3-flash-tokens-input", "0.0001000000", { flag: "legacy-name-priced-as-successor" }),
        item("instantly-email-send", "6.1038000000", { method: "email-send-price", realCostUsdCents: "3.0519000000" }),
        item("apollo-search-credit", "0.0000000000", { method: "included-at-vendor", realCostUsdCents: "0.0000000000" }),
        item("some-unknown-name", "1.0000000000"),
      ],
      catalogue,
      NOW,
    );
    expect(plan.writes.map((w) => [w.costName, w.templateName, w.vendorCostUsdCents])).toEqual([
      // a subscription credit: the template's vendor rate is another unit's, so it is not carried
      ["apollo-enrichment-credit", "apollo-credit", null],
      // a legacy name is the same model as its successor: its vendor rate is carried
      ["gemini-3-flash-tokens-input", "google-flash-3-tokens-input", "0.0000500000"],
      ["instantly-email-send", "instantly-account-email-sent", "3.0519000000"],
      ["apollo-search-credit", "apollo-credit", "0.0000000000"],
    ]);
    expect(plan.kept).toEqual([{ costName: "some-unknown-name", reason: "not in the catalogue and no catalogued name of its family to copy", billedPriceUsdCents: null }]);
  });

  it("template names resolve by family", () => {
    expect(catalogueTemplateName("apollo-person-match-credit", catalogue, NOW)).toBe("apollo-credit");
    expect(catalogueTemplateName("gemini-3-flash-tokens-input", catalogue, NOW)).toBe("google-flash-3-tokens-input");
    expect(catalogueTemplateName("instantly-email-send", catalogue, NOW)).toBe("instantly-account-email-sent");
    expect(catalogueTemplateName("nope", catalogue, NOW)).toBeNull();
  });
});
