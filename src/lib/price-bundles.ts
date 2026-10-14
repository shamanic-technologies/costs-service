import { EMAIL_SENT_BASE_NAMES, EMAIL_VERDICTS, EMAIL_VERIFIER, type EmailVerdict } from "./price-lists.js";

/**
 * Outcomes a client pays for that our services declare as SEVERAL cost names at once.
 *
 * One email sent to a lead is declared by instantly-service as one `instantly-account-email-sent`
 * unit AND one `instantly-domain-email-sent` unit (the email send price is split 50/50 between
 * them, `EMAIL_SEND_COST_SHARES`). Each row alone states half of what a client pays per email, so
 * the public price list carries the bundle on each member row with the price of the whole outcome.
 * A consumer showing "price per email" reads `bundle.pricePerUnitInUsdCents`, never sums rows itself.
 *
 * One email bundle per BounceVerify verdict we send to (`EMAIL_VERDICTS`): `email-sent` (valid, the
 * original names), `email-sent-catch-all`, `email-sent-unknown`, each labelled with its verdict and
 * the verifier so a price list can say which address the price is for.
 */
export type PriceBundle = {
  name: string;
  /** The outcome one bundle unit is (what the client counts). */
  unit: string;
  /** What the client pays for, in words. */
  label: string;
  /** Each member name and how many of its units one outcome declares. */
  members: readonly { costName: string; unitsPerBundle: number }[];
  emailVerification: { provider: string; verdict: EmailVerdict["verdict"]; priceMultipleOfValid: number; validBundle: string } | null;
};

const VALID_EMAIL_BUNDLE = "email-sent";

export const PRICE_BUNDLES: readonly PriceBundle[] = EMAIL_VERDICTS.map((v) => ({
  name: `${VALID_EMAIL_BUNDLE}${v.nameSuffix}`,
  unit: "email",
  label: `Email sent, address verified ${v.label} by ${EMAIL_VERIFIER}`,
  members: EMAIL_SENT_BASE_NAMES.map((b) => ({ costName: `${b}${v.nameSuffix}`, unitsPerBundle: 1 })),
  emailVerification: { provider: EMAIL_VERIFIER, verdict: v.verdict, priceMultipleOfValid: v.priceMultipleOfValid, validBundle: VALID_EMAIL_BUNDLE },
}));

export type ServedBundle = {
  name: string;
  unit: string;
  members: string[];
  pricePerUnitInUsdCents: string | null;
  label: string;
  emailVerification: PriceBundle["emailVerification"];
};

/**
 * The bundle a cost name belongs to, priced from the CURRENT member prices. A member with no
 * current price (delisted, absent) leaves the bundle unpriced: null, never a partial sum.
 */
export function bundleOf(costName: string, currentPrices: ReadonlyMap<string, string | null>): ServedBundle | null {
  const b = PRICE_BUNDLES.find((x) => x.members.some((m) => m.costName === costName));
  if (!b) return null;
  const served = { name: b.name, unit: b.unit, members: b.members.map((x) => x.costName), label: b.label, emailVerification: b.emailVerification };
  let total = 0;
  for (const m of b.members) {
    const p = currentPrices.get(m.costName);
    if (p === undefined || p === null) return { ...served, pricePerUnitInUsdCents: null };
    total += Number(p) * m.unitsPerBundle;
  }
  return { ...served, pricePerUnitInUsdCents: total.toFixed(10) };
}
