# Vendor cost from what we paid (cold-email infrastructure, Featured)

Staff read costs on an "actual cost" basis: each billed cost row priced at what that unit cost
us from the vendor, as costs-service states it per price version (`/internal/vendor-costs`).
For most lines the statement reproduces the billed price from the seed's vendor rate. Two
families cannot be stated that way, and this document is the derivation for the one that needs
the owner's figure. Code: `src/lib/vendor-cost-statements.ts`. Inputs:
`tests/fixtures/paid-allocation-inputs.json`. Proof: `tests/unit/vendor-cost-statements.test.ts`
re-derives every figure below from those inputs, byte-equal at 10 decimals.

## Why not the seed rate

The cold-email lines (`instantly-contact-uploaded`, `instantly-account-email-sent`,
`instantly-domain-email-sent`, and before 2026-04-20 the single `instantly-email-send`) and
`featured-api-pitch-submit` were priced on a MODEL: a plan price divided by an assumed volume
("$10/mo per account / 600 emails", "$99 / 100 pitches"). The model changed five times in four
months (0.08 to 1.64 cents per email) and none of its figures is what the infrastructure cost.
The Instantly lines are also delisted, so the seed holds no rate for them at all, and production
read $3.3k of billed spend as "vendor cost unknown".

## Method

1. **Charges.** Every bank charge for the service, February to August 2026, from the company
   account (Qonto): `INSTANTLY` (subscription), `FORGE` (Mailforge / Primeforge mailboxes),
   `Gandi order` (domains, mailboxes), `FEATURED` / `CONNECTIVELY` (Featured subscription).
   USD charges at their USD amount; EUR charges converted at that month's rate implied by our own
   USD card charges. Excluded: Google Workspace (staff seats), the Claude Max seat (not sending
   infrastructure), and a recurring `NS.COM` charge that is not sending infrastructure.
2. **Coverage.** A charge pays for the 30 days starting the day it settles; each period gets the
   share of every charge that falls inside it. Sending periods stop on 2026-08-23 (the day the
   lines were delisted and stopped carrying usage), Featured on 2026-08-05 (its last billed pitch).
3. **Allocation**, by what each line priced:
   - mailbox + domain charges (FORGE, Gandi) -> `instantly-account-email-sent`, per email sent;
   - the Instantly subscription (Instantly sells plans by uploaded contacts) ->
     `instantly-contact-uploaded`, per contact;
   - `instantly-domain-email-sent` -> **0**: its domain share is already inside the account
     line's figure, and stating it twice would count the same charges twice;
   - before 2026-04-20 (`instantly-email-send`, one line for everything) -> all charges, per email;
   - Featured subscription -> `featured-api-pitch-submit`, per pitch.
4. **Per period rate** = the period's allocated charges / the units production recorded in it
   (`runs_costs`, actual + provisioned). Periods: calendar months, with April split on 2026-04-20.
5. **Per price version** = the unit-weighted mean of the period rates over the periods its units
   were billed in, in cents, rounded half-up to 10 decimals.

## Result (cents per unit)

| Line | Billed at | Rows billed | Vendor cost stated |
|---|---|---|---|
| instantly-email-send | 0.94 | 2026-02-10 .. 04-19 | 6.8469579746 |
| instantly-account-email-sent | 1.6667 | 04-20 .. 05-03 | 0.3050234605 |
| instantly-account-email-sent | 3.3334 | 05-03 .. 06-07 | 0.6572392271 |
| instantly-account-email-sent | 0.1587301588 | 06-07 .. 06-26 | 0.4231984164 |
| instantly-account-email-sent | 1.4285714286 | 06-26 .. 07-01 | 0.5293825133 |
| instantly-account-email-sent | 3.2740740740 | 07-01 .. 07-09 | 3.2019983098 |
| instantly-account-email-sent | 6.5481481480 | 07-10 .. 08-23 | 2.7788644351 |
| instantly-domain-email-sent | every version | 04-20 .. 08-23 | 0 (inside the account line) |
| instantly-contact-uploaded | 0.388 | 04-20 .. 05-03 | 2.3216129950 |
| instantly-contact-uploaded | 0.776 (and growth 9.4) | 05-03 .. 07-09 | 1.2570362824 |
| instantly-contact-uploaded | 1.552 (and growth 18.8) | 07-10 .. 08-23 | 7.5189025220 |
| featured-api-pitch-submit | 198 / 1398 / 200 | 06-01 .. 06-29 | 16.5 |
| featured-api-pitch-submit | 0.1 | 07-03 .. 07-09 | 22.1254857997 |
| featured-api-pitch-submit | 0.2 | 07-09 .. 08-05 | 23.7789929340 |

The July jump in the per-email figure is real: that month bought the Mailforge / Primeforge
mailbox fleet (about $780 of FORGE charges) while sending fewer emails than June.

Featured versions written after 2026-08-05 carry no billed pitch and keep the seed's statement.
If Featured is used again, restate them from the charges of that period the same way.

## The other family: versions that no longer exist

Before v0.25.0 (2026-06-07) the seed overwrote prices in place, so every version served before
the 2026-05-03 risk markup (stored at 1x, i.e. the vendor rate itself) was replaced by its 2x
value. Production still holds cost rows that froze those prices. They are listed as
`reconstructed: true` versions on `GET /internal/vendor-costs` (vendor cost = the seed literal,
found in git history), and are never written into `providers_costs`: that would change the
billed catalogue.

## Re-running

Re-export the charges and the per-period units into the fixture, change the statements, and
`npx vitest run tests/unit/vendor-cost-statements.test.ts` tells you whether every stated figure
still follows from them. A statement already written to production is restated on the next boot
(`recordVendorCosts`).
