import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

/**
 * Twilio outbound voice is priced PER MINUTE and the rate is set by the DESTINATION, with
 * an order-of-magnitude spread (US $0.014/min vs France mobile $0.1603/min). The catalog
 * therefore carries one cost name per destination band rather than one blended name — see
 * the block comment above these rows in src/db/seed.ts.
 */
const VOICE_ROWS = [
  {
    name: "twilio-voice-outbound-minute-us",
    type: "Outbound voice minute (US)",
    vendorCentsPerMinute: "1.4000000000",
  },
  {
    name: "twilio-voice-outbound-minute-fr-landline",
    type: "Outbound voice minute (France, landline)",
    vendorCentsPerMinute: "1.8700000000",
  },
  {
    name: "twilio-voice-outbound-minute-fr-mobile",
    type: "Outbound voice minute (France, mobile)",
    vendorCentsPerMinute: "16.0300000000",
  },
] as const;

describe("Twilio outbound voice unit costs", () => {
  for (const expected of VOICE_ROWS) {
    it(`registers ${expected.name} at the vendor's per-minute rate for that destination`, () => {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === expected.name);
      expect(row).toBeDefined();
      expect(row!.provider).toBe("twilio");
      expect(row!.providerDomain).toBe("twilio.com");
      expect(row!.type).toBe(expected.type);
      expect(row!.unit).toBe("minute");
      expect(row!.planTier).toBe("pay-as-you-go");
      expect(row!.billingCycle).toBe("monthly");
      // Placing the call is work we perform, not money we merely route.
      expect(row!.pricingBasis).toBe("marked-up");
      expect(row!.costPerUnitInUsdCents).toBe(
        applyCostRiskMultiplier(expected.vendorCentsPerMinute),
      );
    });

    it(`resolves ${expected.name} against the active twilio platform cost`, () => {
      const row = SEED_PROVIDERS_COSTS.find((c) => c.name === expected.name)!;
      const platform = SEED_PLATFORM_COSTS.find((c) => c.provider === "twilio");
      expect(platform).toBeDefined();
      // Price resolution joins providers_costs <-> platform_costs on (planTier, billingCycle).
      // A mismatch makes GET /v1/platform-prices/<name> 404; a missing platform row makes it 500.
      expect(row.planTier).toBe(platform!.planTier);
      expect(row.billingCycle).toBe(platform!.billingCycle);
    });
  }

  it("keeps the destination bands as distinct names rather than one blended rate", () => {
    const prices = VOICE_ROWS.map(
      (r) => SEED_PROVIDERS_COSTS.find((c) => c.name === r.name)!.costPerUnitInUsdCents,
    );
    // Three destinations, three distinct prices. If a future edit collapses these onto one
    // number, the catalog has started quoting a rate Twilio never charges for at least two
    // of them — which is exactly what the per-destination naming exists to prevent.
    expect(new Set(prices).size).toBe(3);
  });

  it("does not declare an inbound or a destination-agnostic voice name", () => {
    // The catalog prices OUTBOUND voice only, and always for a named destination. A name
    // without a destination band could not be priced honestly for more than one of them.
    const voiceNames = SEED_PROVIDERS_COSTS.filter(
      (c) => c.provider === "twilio" && c.unit === "minute",
    ).map((c) => c.name);
    expect(voiceNames.sort()).toEqual(VOICE_ROWS.map((r) => r.name).sort());
  });
});
