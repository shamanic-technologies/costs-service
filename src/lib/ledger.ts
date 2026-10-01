import { z } from "zod";

/**
 * Money facts READ from Kevin's bank ledger (admin.kevinlourd.com), never typed by hand here:
 * which of our accounts pays each catalogue provider (`GET /api/v1/vendors`), and every payment
 * to a named set of vendors with its USD figure (`GET /api/v1/vendor-payments`, the numerator of
 * the email send price).
 *
 * The ledger already knows every payment and to whom it went. costs-service only joins its
 * own provider catalogue to the ledger's vendors; it stores nothing, caches nothing, and a
 * ledger that is unconfigured, unreachable or answers in a shape we do not recognise is a
 * `LedgerError` the route turns into a 502 — never an empty list that reads as "nobody pays".
 */

const LEDGER_TIMEOUT_MS = 15_000;

const LedgerAccountSchema = z.object({
  accountId: z.string(),
  label: z.string(),
  institutionDomain: z.string().nullable(),
  scope: z.enum(["personal", "business"]),
  connector: z.string(),
  lastPaidOn: z.string(),
});

const LedgerVendorSchema = z.object({
  key: z.string(),
  name: z.string(),
  lastPaidOn: z.string(),
  paidFrom: z.array(LedgerAccountSchema),
});

const LedgerVendorsResponseSchema = z.object({
  generatedAt: z.string(),
  vendors: z.array(LedgerVendorSchema),
});

export type LedgerVendor = z.infer<typeof LedgerVendorSchema>;
export type LedgerVendors = z.infer<typeof LedgerVendorsResponseSchema>;

export class LedgerError extends Error {}

export async function fetchLedgerVendors(): Promise<LedgerVendors> {
  return (await ledgerRead("/api/v1/vendors", LedgerVendorsResponseSchema)).data;
}

// --- Payments to named vendors, with a USD figure per bank line ----------------------------

const LedgerVendorPaymentSchema = z.object({
  id: z.string(),
  vendor: z.string(),
  bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["payment", "refund"]),
  amount: z.number(),
  currency: z.string(),
  eurAmount: z.number(),
  usdAmount: z.number(),
  accountId: z.string(),
});

const LedgerVendorTotalsSchema = z.object({
  key: z.string(),
  firstPaidOn: z.string().nullable(),
  lastPaidOn: z.string().nullable(),
  payments: z.number().int(),
  refunds: z.number().int(),
  paidUsd: z.number(),
  refundedUsd: z.number(),
  netUsd: z.number(),
});

const LedgerVendorPaymentsResponseSchema = z.object({
  generatedAt: z.string(),
  since: z.string().nullable(),
  vendors: z.array(LedgerVendorTotalsSchema),
  payments: z.array(LedgerVendorPaymentSchema),
});

export type LedgerVendorPayment = z.infer<typeof LedgerVendorPaymentSchema>;
export type LedgerVendorPayments = z.infer<typeof LedgerVendorPaymentsResponseSchema>;

/**
 * Every bank line to (payment) or from (refund) the named ledger vendor keys, since the first
 * line the ledger holds. A key the ledger never paid is a 404 there and a `LedgerError` here —
 * never an empty list that reads as "we spent nothing".
 */
export async function fetchLedgerVendorPayments(
  keys: readonly string[],
): Promise<{ url: string; body: unknown; data: LedgerVendorPayments }> {
  const query = new URLSearchParams({ vendors: keys.join(",") });
  return ledgerRead(`/api/v1/vendor-payments?${query.toString()}`, LedgerVendorPaymentsResponseSchema);
}

// --- Google Cloud money split by what it paid for (admin PR KevinLourd/kevinlourd.com#298) ---

const GoogleCloudMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  export: z
    .object({
      coveredFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      coveredTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      partial: z.boolean(),
      consumption: z.array(z.object({ service: z.string(), netEur: z.number() })),
      consumptionEur: z.number(),
      taxEur: z.number(),
      adjustmentsEur: z.number(),
      roundingEur: z.number(),
      invoiceEur: z.number(),
      prepayments: z.array(z.object({ chargedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), totalEur: z.number() })),
      prepaidEur: z.number(),
    })
    .nullable(),
  bank: z.object({
    payments: z.array(z.object({ eurAmount: z.number(), usdAmount: z.number(), direction: z.enum(["payment", "refund"]) })),
    paidEur: z.number(),
    prepaidEur: z.number(),
  }),
  explainedEur: z.number(),
  unexplainedEur: z.number(),
  notes: z.array(z.string()),
});

const GoogleCloudSplitSchema = z.object({
  generatedAt: z.string(),
  vendor: z.literal("google cloud"),
  currency: z.literal("EUR"),
  since: z.string(),
  until: z.string(),
  months: z.array(GoogleCloudMonthSchema),
});

export type GoogleCloudSplit = z.infer<typeof GoogleCloudSplitSchema>;

/**
 * Google Cloud money per invoice month, split by GCP service from the billing export, tax,
 * adjustments and prepaid top-ups apart, and the bank money the export cannot explain. EUR.
 */
export async function fetchGoogleCloudSplit(sinceMonth: string): Promise<{ url: string; body: unknown; data: GoogleCloudSplit }> {
  return ledgerRead(`/api/v1/vendor-payments/google-cloud?${new URLSearchParams({ since: sinceMonth })}`, GoogleCloudSplitSchema);
}

/** GET a ledger path; returns the raw body beside the validated one (the raw is kept as bronze). */
async function ledgerRead<T>(pathAndQuery: string, schema: z.ZodType<T>): Promise<{ url: string; body: unknown; data: T }> {
  const baseUrl = process.env.LEDGER_API_URL;
  const apiKey = process.env.LEDGER_API_KEY;
  const missing = [!baseUrl && "LEDGER_API_URL", !apiKey && "LEDGER_API_KEY"].filter(Boolean);
  if (missing.length > 0) {
    throw new LedgerError(`Bank ledger not configured: ${missing.join(" and ")} missing from costs-service env`);
  }

  const url = `${baseUrl!.replace(/\/+$/, "")}${pathAndQuery}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
    });
  } catch (err) {
    throw new LedgerError(`Bank ledger unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new LedgerError(`Bank ledger refused ${url}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new LedgerError(`Bank ledger answered ${url} with non-JSON: ${text.slice(0, 300)}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new LedgerError(`Bank ledger answered ${url} in an unexpected shape: ${parsed.error.message.slice(0, 500)}`);
  }
  return { url, body, data: parsed.data };
}

// --- Matching a catalogue provider to the ledger's vendors ---------------------------------

/** "instantly.ai" -> ["instantly", "ai"]; "serper-dev" -> ["serper", "dev"]. */
function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t !== "www");
}

/**
 * The word sequences a bank line may name a provider by: its catalogue key ("google-ads"),
 * its domain ("instantly.ai"), and the domain's name without the TLD ("instantly").
 * Single letters are KEPT here while the ledger drops them from its keys, so "x-ads" / "x.com"
 * can never collapse onto a bare "ads" and match whatever vendor starts with it.
 */
export function providerNames(provider: string, providerDomain: string | null): string[][] {
  const names: string[][] = [tokens(provider)];
  if (providerDomain) {
    const host = providerDomain.toLowerCase().replace(/^www\./, "");
    names.push(tokens(host));
    const labels = host.split(".");
    if (labels.length >= 2) names.push(tokens(labels.slice(0, -1).join(".")));
  }
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = n.join(" ");
    if (n.length === 0 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function startsWith(haystack: string[], needle: string[], at = 0): boolean {
  return at + needle.length <= haystack.length && needle.every((t, i) => haystack[at + i] === t);
}

function containsWords(haystack: string[], needle: string[]): boolean {
  for (let at = 1; at + needle.length <= haystack.length; at++) if (startsWith(haystack, needle, at)) return true;
  return false;
}

/**
 * How well one provider name fits a vendor key: a key STARTING with the name beats a key that
 * only CONTAINS it as whole words further in (a reseller line, "paddle net serper"); within a
 * tier the longer name wins. 0 = no fit.
 */
function fit(key: string[], name: string[]): number {
  if (startsWith(key, name)) return 1000 + name.length;
  if (containsWords(key, name)) return name.length;
  return 0;
}

export type CatalogueProvider = { provider: string; providerDomain: string | null };

/**
 * Deterministic join: a ledger vendor belongs to the provider whose name its key STARTS WITH,
 * word for word ("instantly ai" -> instantly, "google ads" -> google-ads), or failing any such
 * provider, whose name it CONTAINS as whole words ("paddle net serper" -> serper-dev). When
 * several providers fit, the best `fit` wins ("google ads" goes to google-ads, not google;
 * "google youtube" goes to google, not youtube-ads); a tie is ambiguous and the vendor is
 * attached to neither. No fuzzy match, no hand-kept alias list: a provider nothing fits stays
 * visibly unmatched.
 */
export function matchVendors(
  providers: CatalogueProvider[],
  vendors: LedgerVendor[],
): Map<string, LedgerVendor[]> {
  const names = providers.map((p) => ({ provider: p.provider, names: providerNames(p.provider, p.providerDomain) }));
  const byProvider = new Map<string, LedgerVendor[]>(providers.map((p) => [p.provider, []]));

  for (const vendor of vendors) {
    const key = tokens(vendor.key);
    let best = 0;
    let winners: string[] = [];
    for (const { provider, names: candidates } of names) {
      const len = Math.max(0, ...candidates.map((n) => fit(key, n)));
      if (len === 0) continue;
      if (len > best) {
        best = len;
        winners = [provider];
      } else if (len === best) {
        winners.push(provider);
      }
    }
    if (winners.length === 1) byProvider.get(winners[0])!.push(vendor);
  }
  return byProvider;
}

export type PaidFromAccount = {
  accountId: string;
  label: string;
  institutionDomain: string | null;
  scope: "personal" | "business";
  lastPaidOn: string;
};

/** One entry per account across every matched vendor, its latest payment, most recent first. */
export function paidFromAccounts(vendors: LedgerVendor[]): PaidFromAccount[] {
  const byAccount = new Map<string, PaidFromAccount>();
  for (const vendor of vendors) {
    for (const a of vendor.paidFrom) {
      const prev = byAccount.get(a.accountId);
      if (!prev || a.lastPaidOn > prev.lastPaidOn) {
        byAccount.set(a.accountId, {
          accountId: a.accountId,
          label: a.label,
          institutionDomain: a.institutionDomain,
          scope: a.scope,
          lastPaidOn: a.lastPaidOn,
        });
      }
    }
  }
  return [...byAccount.values()].sort(
    (a, b) => b.lastPaidOn.localeCompare(a.lastPaidOn) || a.accountId.localeCompare(b.accountId),
  );
}
