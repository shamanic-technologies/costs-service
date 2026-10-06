/**
 * Cost names we no longer run: no service of ours emits them today, and each one's work (if any)
 * is now declared under the names in `supersededBy`. Owner-reviewable, one entry per name.
 *
 * Why the catalogue still prices them: runs-service holds historical cost rows under these names
 * and reconcile sweeps still resolve them by name, and the proposed-list sync gives every name
 * runs-service ever recorded a price (`src/lib/catalogue-sync.ts`). So they stay billable and
 * resolvable; what changes is that the public price list SAYS they are retired
 * (`status: "retired"` + `supersededBy`), so a consumer can tell a price we run today from one we
 * stopped running, and never shows two names for the same work side by side.
 *
 * Why a declaration and not "unused in runs for N days": idle is not retired. A selectable model
 * nobody picked this month (Gemini 3.5 Flash), an opt-in tool (web search), a channel no client
 * has bought yet (every ad line) are all things we run today. Only the catalogue owner knows a
 * name was replaced, so the entry is written in the same PR that seeds or adopts its successor.
 *
 * Retiring a name here never re-prices it and never removes it: same doctrine as a superseded
 * cost name or a retired provider (CLAUDE.md).
 */
import { LEGACY_COST_NAMES } from "./price-lists.js";

export type Retirement = { supersededBy: readonly string[]; reason: string };

const TOKEN_CLASSES = ["tokens-input", "tokens-output", "tokens-cached-input"] as const;

/** One entry per token class of a retired model, each superseded by the same class of the successor. */
function retiredModel(
  oldPrefix: string,
  newPrefix: string,
  reason: string,
  classes: readonly string[] = TOKEN_CLASSES,
): Record<string, Retirement> {
  return Object.fromEntries(classes.map((c) => [`${oldPrefix}-${c}`, { supersededBy: [`${newPrefix}-${c}`], reason }]));
}

const DEEPSEEK_V4_REASON =
  "DeepSeek retired V4 Flash and V4 Pro; chat-service sends every DeepSeek call to V4.1 Flash";

/** DeepSeek V4 Flash / Pro, every token class, regime-free and peak/off-peak names alike. */
function retiredDeepSeekV4(model: "flash" | "pro"): Record<string, Retirement> {
  const out: Record<string, Retirement> = {};
  for (const c of TOKEN_CLASSES) {
    // The regime-free names were superseded by the peak/off-peak split on 2026-08-16 (never had a cached-input name).
    if (c !== "tokens-cached-input") out[`deepseek-v4-${model}-${c}`] = {
      supersededBy: [`deepseek-v4.1-flash-peak-${c}`, `deepseek-v4.1-flash-off-peak-${c}`],
      reason: DEEPSEEK_V4_REASON,
    };
    for (const regime of ["peak", "off-peak"]) {
      out[`deepseek-v4-${model}-${regime}-${c}`] = { supersededBy: [`deepseek-v4.1-flash-${regime}-${c}`], reason: DEEPSEEK_V4_REASON };
    }
  }
  return out;
}

const DECLARED: Record<string, Retirement> = {
  ...retiredModel("anthropic-opus-4.5", "anthropic-opus-4.6", "Claude Opus 4.5 is no longer offered by chat-service", ["tokens-input", "tokens-output"]),
  ...retiredModel("anthropic-sonnet-4.5", "anthropic-sonnet-4.6", "Claude Sonnet 4.5 is no longer offered by chat-service", ["tokens-input", "tokens-output"]),
  ...retiredModel("google-flash-lite-2.5", "google-flash-lite-3.5", "Gemini 2.5 Flash-Lite is no longer offered by chat-service"),
  ...retiredModel("openai-gpt-5.6-sol", "openai-gpt-6-sol", "GPT-5.6 Sol is not an OpenAI model we call; GPT-6 Sol is"),
  ...retiredDeepSeekV4("flash"),
  ...retiredDeepSeekV4("pro"),
  "instantly-email-send": {
    supersededBy: ["instantly-account-email-sent", "instantly-domain-email-sent"],
    reason: "One email is now declared as one unit per sending account plus one per sending domain",
  },
  "serper-dev-search-query": { supersededBy: ["serper-dev-query"], reason: "Renamed" },
  "scrape-do-scrape-credit": { supersededBy: ["scrape-do-credit"], reason: "Every Scrape.do request is now one scrape-do-credit" },
  "scrape-do-render-credit": { supersededBy: ["scrape-do-credit"], reason: "Every Scrape.do request is now one scrape-do-credit" },
  "scrape-do-render-super-credit": { supersededBy: ["scrape-do-credit"], reason: "Every Scrape.do request is now one scrape-do-credit" },
  "apollo-enrichment-credit": { supersededBy: ["apollo-credit"], reason: "Every Apollo credit is now one apollo-credit" },
  "apollo-person-match-credit": { supersededBy: ["apollo-credit"], reason: "Every Apollo credit is now one apollo-credit" },
  "apollo-search-credit": { supersededBy: [], reason: "Apollo deducts no credit for search; apollo-service stopped declaring it" },
};

/** Every retired name: the declarations above plus every legacy name priced as its successor. */
export const RETIRED_COST_NAMES: Readonly<Record<string, Retirement>> = {
  ...Object.fromEntries(
    Object.entries(LEGACY_COST_NAMES).map(([name, l]) => [name, { supersededBy: [l.successor], reason: l.reason }]),
  ),
  ...DECLARED,
};

export type CostNameStatus = { status: "current" | "retired"; supersededBy: string[] | null };

export function costNameStatus(name: string): CostNameStatus {
  const r = RETIRED_COST_NAMES[name];
  return r ? { status: "retired", supersededBy: [...r.supersededBy] } : { status: "current", supersededBy: null };
}
