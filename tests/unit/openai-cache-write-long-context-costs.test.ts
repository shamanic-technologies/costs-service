import { describe, expect, it } from "vitest";
import { SEED_PROVIDERS_COSTS, applyCostRiskMultiplier } from "../../src/db/seed.js";

// LLM-HEADS-1027. OpenAI bills cache writes at 1.25x input and a >272K-token request at
// 2x input / cache / cache write and 1.5x output (developers.openai.com model pages, read
// 2026-10-27). Full list prices only, never an intro rate.
const price = (name: string) => SEED_PROVIDERS_COSTS.find((c) => c.name === name)?.costPerUnitInUsdCents;
const usd = (perMTok: number) => applyCostRiskMultiplier((perMTok / 10_000).toFixed(10));

describe("OpenAI cache-write and long-context rows", () => {
  it.each([
    ["openai-gpt-6.1-sol", 2, 0.1, 10],
    ["openai-gpt-6.1-terra", 1, 0.05, 5],
    ["openai-gpt-6-astra", 10, 1, 50],
    ["openai-gpt-6-sol", 2, 0.2, 10],
    ["openai-gpt-5.6-sol", 4, 0.4, 20],
    ["openai-gpt-5.6-terra", 2, 0.2, 12],
  ])("%s carries every dimension at the vendor's rate", (prefix, input, cached, output) => {
    expect(price(`${prefix}-tokens-input`)).toBe(usd(input));
    expect(price(`${prefix}-tokens-cached-input`)).toBe(usd(cached));
    expect(price(`${prefix}-tokens-output`)).toBe(usd(output));
    expect(price(`${prefix}-tokens-cache-write`)).toBe(usd(input * 1.25));
    expect(price(`${prefix}-long-context-tokens-input`)).toBe(usd(input * 2));
    expect(price(`${prefix}-long-context-tokens-cached-input`)).toBe(usd(cached * 2));
    expect(price(`${prefix}-long-context-tokens-cache-write`)).toBe(usd(input * 2.5));
    expect(price(`${prefix}-long-context-tokens-output`)).toBe(usd(output * 1.5));
  });

  it("seeds Kimi K3.1 Pro at Moonshot's list price, no cache-write row", () => {
    expect(price("moonshot-kimi-k3.1-pro-tokens-input")).toBe(usd(2));
    expect(price("moonshot-kimi-k3.1-pro-tokens-cached-input")).toBe(usd(0.2));
    expect(price("moonshot-kimi-k3.1-pro-tokens-output")).toBe(usd(10));
    expect(price("moonshot-kimi-k3.1-pro-tokens-cache-write")).toBeUndefined();
  });

  it("seeds Gemini 4 Argon at its full price, never the introductory $2/$10", () => {
    expect(price("google-argon-4-tokens-input")).toBe(usd(4));
    expect(price("google-argon-4-tokens-cached-input")).toBe(usd(0.2));
    expect(price("google-argon-4-tokens-output")).toBe(usd(20));
  });

  it("seeds each new name exactly once", () => {
    const fresh = SEED_PROVIDERS_COSTS.filter((c) => /cache-write$|long-context-tokens-(input|cached-input|output|cache-write)$|gpt-6\.1-|kimi-k3\.1-pro|argon-4/.test(c.name) && c.provider !== "anthropic" && !c.name.startsWith("google-pro"));
    const names = fresh.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
