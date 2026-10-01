import { z } from "zod";

/**
 * Emails sent to leads per UTC day, read from instantly-service's staff ops read
 * (`GET /internal/ops/sent-per-period?grain=day`). `toLeads` = `outreach` sends only:
 * warmup, warmup replies, seeds and manual replies are counted apart there and never reach us.
 *
 * Unconfigured, unreachable, refused or unrecognised = `InstantlyServiceError`, never zero days.
 */

const TIMEOUT_MS = 30_000;

const SentPerPeriodSchema = z.object({
  grain: z.literal("day"),
  asOf: z.string(),
  totals: z.object({ toLeads: z.number().int() }),
  periods: z.array(
    z.object({
      periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      inProgress: z.boolean(),
      toLeads: z.number().int().nonnegative(),
    }),
  ),
});

export type SentToLeadsPerDay = z.infer<typeof SentPerPeriodSchema>;

export class InstantlyServiceError extends Error {}

export async function fetchEmailsToLeadsPerDay(): Promise<{ url: string; body: unknown; parsed: SentToLeadsPerDay }> {
  const baseUrl = process.env.INSTANTLY_SERVICE_URL;
  const apiKey = process.env.INSTANTLY_SERVICE_API_KEY;
  const missing = [!baseUrl && "INSTANTLY_SERVICE_URL", !apiKey && "INSTANTLY_SERVICE_API_KEY"].filter(Boolean);
  if (missing.length > 0) {
    throw new InstantlyServiceError(`instantly-service not configured: ${missing.join(" and ")} missing from costs-service env`);
  }

  const url = `${baseUrl!.replace(/\/+$/, "")}/internal/ops/sent-per-period?grain=day`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-api-key": apiKey!, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new InstantlyServiceError(`instantly-service unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new InstantlyServiceError(`instantly-service refused ${url}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new InstantlyServiceError(`instantly-service answered ${url} with non-JSON: ${text.slice(0, 300)}`);
  }
  const parsed = SentPerPeriodSchema.safeParse(body);
  if (!parsed.success) {
    throw new InstantlyServiceError(`instantly-service answered ${url} in an unexpected shape: ${parsed.error.message.slice(0, 500)}`);
  }
  return { url, body, parsed: parsed.data };
}
