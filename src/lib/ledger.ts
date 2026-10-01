import { z } from "zod";

/**
 * Which of our accounts pays each catalogue provider — READ from Kevin's bank ledger
 * (admin.kevinlourd.com, `GET /api/v1/vendors`), never typed by hand here.
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
  const baseUrl = process.env.LEDGER_API_URL;
  const apiKey = process.env.LEDGER_API_KEY;
  const missing = [!baseUrl && "LEDGER_API_URL", !apiKey && "LEDGER_API_KEY"].filter(Boolean);
  if (missing.length > 0) {
    throw new LedgerError(`Bank ledger not configured: ${missing.join(" and ")} missing from costs-service env`);
  }

  const url = `${baseUrl!.replace(/\/+$/, "")}/api/v1/vendors`;
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
  const parsed = LedgerVendorsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new LedgerError(`Bank ledger answered ${url} in an unexpected shape: ${parsed.error.message.slice(0, 500)}`);
  }
  return parsed.data;
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

function startsWith(haystack: string[], needle: string[]): boolean {
  return needle.length <= haystack.length && needle.every((t, i) => haystack[i] === t);
}

export type CatalogueProvider = { provider: string; providerDomain: string | null };

/**
 * Deterministic join: a ledger vendor belongs to the provider whose name its key STARTS WITH,
 * word for word ("instantly ai" -> instantly, "google ads" -> google-ads). When several
 * providers fit, the longest name wins ("google ads" goes to google-ads, not google); a tie
 * between two providers is ambiguous and the vendor is attached to neither. No fuzzy match,
 * no hand-kept alias list: a provider nothing fits stays visibly unmatched.
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
      const len = Math.max(0, ...candidates.filter((n) => startsWith(key, n)).map((n) => n.length));
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
