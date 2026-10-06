/**
 * Outcomes a client pays for that our services declare as SEVERAL cost names at once.
 *
 * One email sent to a lead is declared by instantly-service as one `instantly-account-email-sent`
 * unit AND one `instantly-domain-email-sent` unit (the email send price is split 50/50 between
 * them, `EMAIL_SEND_COST_SHARES`). Each row alone states half of what a client pays per email, so
 * the public price list carries the bundle on each member row with the price of the whole outcome.
 * A consumer showing "price per email" reads `bundle.pricePerUnitInUsdCents`, never sums rows itself.
 */
export type PriceBundle = {
  name: string;
  /** The outcome one bundle unit is (what the client counts). */
  unit: string;
  /** Each member name and how many of its units one outcome declares. */
  members: readonly { costName: string; unitsPerBundle: number }[];
};

export const PRICE_BUNDLES: readonly PriceBundle[] = [
  {
    name: "email-sent",
    unit: "email",
    members: [
      { costName: "instantly-account-email-sent", unitsPerBundle: 1 },
      { costName: "instantly-domain-email-sent", unitsPerBundle: 1 },
    ],
  },
];

export type ServedBundle = { name: string; unit: string; members: string[]; pricePerUnitInUsdCents: string | null };

/**
 * The bundle a cost name belongs to, priced from the CURRENT member prices. A member with no
 * current price (delisted, absent) leaves the bundle unpriced: null, never a partial sum.
 */
export function bundleOf(costName: string, currentPrices: ReadonlyMap<string, string | null>): ServedBundle | null {
  const b = PRICE_BUNDLES.find((x) => x.members.some((m) => m.costName === costName));
  if (!b) return null;
  let total = 0;
  for (const m of b.members) {
    const p = currentPrices.get(m.costName);
    if (p === undefined || p === null) return { name: b.name, unit: b.unit, members: b.members.map((x) => x.costName), pricePerUnitInUsdCents: null };
    total += Number(p) * m.unitsPerBundle;
  }
  return { name: b.name, unit: b.unit, members: b.members.map((x) => x.costName), pricePerUnitInUsdCents: total.toFixed(10) };
}
