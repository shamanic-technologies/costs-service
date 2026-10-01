/**
 * The `vat` block the bank ledger serves on every payment line (KevinLourd/kevinlourd.com#305), for
 * fixtures: a declared rate on top of the amount excluding VAT. `excludingVat + vat` = the gross line.
 */
export function declaredVat(grossUsd: number, rate = 0, grossEur = grossUsd) {
  const excl = (x: number) => Math.round((x / (1 + rate)) * 100) / 100;
  return {
    source: "declared" as "bank" | "declared" | "unknown",
    rate,
    evidence: rate === 0 ? "Bills excluding VAT (owner 2026-10-01)" : `Every line is a price x ${1 + rate}`,
    excludingVat: { amount: excl(grossUsd), eurAmount: excl(grossEur), usdAmount: excl(grossUsd) } as { amount: number; eurAmount: number; usdAmount: number } | null,
    vat: { amount: grossUsd - excl(grossUsd), eurAmount: grossEur - excl(grossEur), usdAmount: grossUsd - excl(grossUsd) } as { amount: number; eurAmount: number; usdAmount: number } | null,
  };
}

export const UNKNOWN_VAT = { source: "unknown" as const, rate: null, evidence: null, excludingVat: null, vat: null };
