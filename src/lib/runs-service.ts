import { z } from "zod";

/**
 * Units consumed per UTC day per cost name, fleet-wide, read from runs-service's service-auth
 * read `GET /internal/stats/costs/consumption`. runs-service keeps the platform key and the
 * customer's own key apart (`costSource`); quantities are decimal strings.
 *
 * Unconfigured, unreachable, refused or unrecognised = `RunsServiceError`, never zero units.
 */

const TIMEOUT_MS = 60_000;

const FiguresSchema = {
  costName: z.string(),
  costSource: z.enum(["platform", "org"]),
  quantity: z.string(),
  refundedQuantity: z.string(),
};

const ConsumptionSchema = z.object({
  timezone: z.literal("UTC"),
  since: z.string().nullable(),
  statuses: z.array(z.string()),
  days: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ...FiguresSchema })),
  totals: z.array(z.object(FiguresSchema)),
});

export type Consumption = z.infer<typeof ConsumptionSchema>;

export class RunsServiceError extends Error {}

export async function fetchConsumption(
  costNames: readonly string[],
  since: string,
): Promise<{ url: string; body: unknown; parsed: Consumption }> {
  const baseUrl = process.env.RUNS_SERVICE_URL;
  const apiKey = process.env.RUNS_SERVICE_API_KEY;
  const missing = [!baseUrl && "RUNS_SERVICE_URL", !apiKey && "RUNS_SERVICE_API_KEY"].filter(Boolean);
  if (missing.length > 0) {
    throw new RunsServiceError(`runs-service not configured: ${missing.join(" and ")} missing from costs-service env`);
  }

  const query = new URLSearchParams({ costNames: costNames.join(","), since });
  const url = `${baseUrl!.replace(/\/+$/, "")}/internal/stats/costs/consumption?${query.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-api-key": apiKey!, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new RunsServiceError(`runs-service unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new RunsServiceError(`runs-service refused ${url}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RunsServiceError(`runs-service answered ${url} with non-JSON: ${text.slice(0, 300)}`);
  }
  const parsed = ConsumptionSchema.safeParse(body);
  if (!parsed.success) {
    throw new RunsServiceError(`runs-service answered ${url} in an unexpected shape: ${parsed.error.message.slice(0, 500)}`);
  }
  return { url, body, parsed: parsed.data };
}
