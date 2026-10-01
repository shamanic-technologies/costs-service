/**
 * Which bank-ledger vendors count as cold-email INFRASTRUCTURE — the numerator of the price of
 * one email sent to a lead (`src/lib/email-send-price.ts`). Declared here, in the service that
 * owns the figure, so the owner reviews one list and no consumer keeps its own.
 *
 * `key` is the ledger's vendor key byte-equal (`GET /api/v1/vendors` on admin.kevinlourd.com,
 * lower-cased words). A key the ledger has never paid makes the refresh fail loud (the ledger
 * answers 404), so a typo here cannot read as "we spent nothing".
 *
 * Owner rule (2026-10-01, LOCKED): everything ever paid to these vendors since inception, all
 * included — Gandi orders placed before the first send count too ("tout confondu").
 */
export type EmailInfraVendor = { key: string; label: string; what: string };

export const EMAIL_INFRA_VENDORS: readonly EmailInfraVendor[] = [
  { key: "instantly", label: "Instantly", what: "Sending platform subscriptions" },
  { key: "forge", label: "Mailforge / Primeforge", what: "Sending mailboxes and pre-warmed inboxes" },
  { key: "gandi order", label: "Gandi", what: "Sending domains and mailboxes" },
  { key: "cloudflare", label: "Cloudflare", what: "DNS for the sending domains" },
];

/**
 * Ledger vendors that LOOK like email infrastructure but are deliberately left out, with the
 * owner's reason. Served beside the included list so the decision is visible, not implied.
 */
export const EXCLUDED_EMAIL_VENDORS: readonly { key: string; reason: string }[] = [
  { key: "google workspace", reason: "Personal and press mailboxes, not cold-email infrastructure" },
  { key: "google workspace press", reason: "Press mailboxes, not cold-email infrastructure" },
];
