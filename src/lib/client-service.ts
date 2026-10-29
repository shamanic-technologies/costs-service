import { z } from "zod";
import { errorReason } from "./pg-error.js";

/**
 * Every org client-service created at or after an instant, with its creation instant, read from
 * its service-auth read `GET /internal/acquisitions?createdAfter=` (shells excluded: an absorbed
 * shell never holds work). Used to decide which price list an org pays (src/lib/org-price-list.ts).
 *
 * Unconfigured, unreachable, refused or unrecognised = `ClientServiceError`, never an empty list.
 */

const TIMEOUT_MS = 10_000;

const AcquisitionsSchema = z.object({
  orgs: z.array(z.object({ orgId: z.string(), createdAt: z.string() })),
});

export class ClientServiceError extends Error {}

export async function fetchOrgsCreatedFrom(from: Date): Promise<Map<string, Date>> {
  const baseUrl = process.env.CLIENT_SERVICE_URL;
  const apiKey = process.env.CLIENT_SERVICE_API_KEY;
  const missing = [!baseUrl && "CLIENT_SERVICE_URL", !apiKey && "CLIENT_SERVICE_API_KEY"].filter(Boolean);
  if (missing.length > 0) {
    throw new ClientServiceError(`client-service not configured: ${missing.join(" and ")} missing from costs-service env`);
  }
  const url = `${baseUrl!.replace(/\/+$/, "")}/internal/acquisitions?${new URLSearchParams({ createdAfter: from.toISOString() }).toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "x-api-key": apiKey!, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ClientServiceError(`client-service unreachable at ${url}: ${errorReason(err)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new ClientServiceError(`client-service refused ${url}: HTTP ${res.status} ${text.slice(0, 300)}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ClientServiceError(`client-service answered ${url} with non-JSON: ${text.slice(0, 300)}`);
  }
  const parsed = AcquisitionsSchema.safeParse(body);
  if (!parsed.success) {
    throw new ClientServiceError(`client-service answered ${url} in an unexpected shape: ${parsed.error.message.slice(0, 500)}`);
  }
  const out = new Map<string, Date>();
  for (const o of parsed.data.orgs) {
    const at = new Date(o.createdAt);
    if (Number.isNaN(at.getTime())) throw new ClientServiceError(`client-service stated org ${o.orgId} created at '${o.createdAt}', not an instant`);
    out.set(o.orgId, at);
  }
  return out;
}
