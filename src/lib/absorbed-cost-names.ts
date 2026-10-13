/**
 * Cost names we still INCUR and RECORD but no longer rebill to any customer. Owner-reviewable,
 * one entry per name.
 *
 * Card-acquiring fees (owner 2026-10-13, "un fonctionnement à la Google Ads"): a customer pays
 * the campaign spend it sets, nothing on top. Stripe and Revolut fees are the PLATFORM's cost for
 * every org. stripe-service keeps declaring each fee into runs-service, on an org-less platform
 * run with cost source `platform`, quantity = the fee in cents, so staff can measure what we
 * absorb.
 *
 * Why this is NOT the cold-email delisting (a NULL price version): runs-service prices every cost
 * row it writes from `GET /v1/platform-prices/:name` and stores `pricePerUnitInUsdCents` on the
 * row. A NULL price there would make every fee write fail (or record a null cost), and a failing
 * write 5xxes Stripe's webhook into a redelivery loop. The cold-email lines could take a NULL
 * because instantly-service STOPPED declaring them; these keep being declared. So the price stays
 * exactly as written (1 cent per cent of fee, pass-through) and the by-name read is unchanged.
 *
 * What changes: the CURRENT CATALOGUE listings (`GET /v1/platform-prices`,
 * `GET /v1/providers-costs`) no longer serve these names, so nothing public presents them as a
 * price a customer pays. Who is billed is decided by the run (org-less = nobody), never by this
 * file. Names and history are never deleted.
 */
export type Absorption = { reason: string };

const CARD_FEES_REASON =
  "Card-acquiring fees are the platform's cost for every org (owner 2026-10-13); still recorded on platform runs";

export const ABSORBED_COST_NAMES: Readonly<Record<string, Absorption>> = {
  "stripe-processing-fee": { reason: CARD_FEES_REASON },
  "stripe-refund-fee": { reason: CARD_FEES_REASON },
  "stripe-dispute-fee": { reason: CARD_FEES_REASON },
  "stripe-payout-failure-fee": { reason: CARD_FEES_REASON },
  "revolut-acquiring-fee": { reason: CARD_FEES_REASON },
};

/** True when the name is absorbed by the platform and must not be listed as a customer price. */
export function isAbsorbedCostName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ABSORBED_COST_NAMES, name);
}
