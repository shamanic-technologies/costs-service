import { describe, it, expect } from "vitest";
import {
  SEED_PROVIDERS_COSTS,
  SEED_PLATFORM_COSTS,
  PROVIDER_DOMAINS,
  applyCostRiskMultiplier,
} from "../../src/db/seed.js";

describe("Cloudflare R2 unit costs (R2 op pricing)", () => {
  it("registers cloudflare-r2-class-a-operation at $4.50/1M ops", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "cloudflare-r2-class-a-operation");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("cloudflare");
    expect(row!.providerDomain).toBe("cloudflare.com");
    expect(row!.unit).toBe("operation");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0004500000"));
  });

  it("registers cloudflare-r2-class-b-operation at $0.36/1M ops", () => {
    const row = SEED_PROVIDERS_COSTS.find((c) => c.name === "cloudflare-r2-class-b-operation");
    expect(row).toBeDefined();
    expect(row!.provider).toBe("cloudflare");
    expect(row!.providerDomain).toBe("cloudflare.com");
    expect(row!.unit).toBe("operation");
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
    expect(row!.costPerUnitInUsdCents).toBe(applyCostRiskMultiplier("0.0000360000"));
  });

  it("registers cloudflare in PROVIDER_DOMAINS", () => {
    expect(PROVIDER_DOMAINS.cloudflare).toBe("cloudflare.com");
  });

  it("registers cloudflare platform cost with pay-as-you-go plan", () => {
    const row = SEED_PLATFORM_COSTS.find((c) => c.provider === "cloudflare");
    expect(row).toBeDefined();
    expect(row!.planTier).toBe("pay-as-you-go");
    expect(row!.billingCycle).toBe("monthly");
  });
});
