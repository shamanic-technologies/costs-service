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
  const query = new URLSearchParams({ costNames: costNames.join(","), since });
  return runsRead(`/internal/stats/costs/consumption?${query.toString()}`, ConsumptionSchema);
}

// --- The same read grouped by org (and brand), with the money billed for each row ---

const MoneySchema = {
  billedCostInUsdCents: z.string(),
  netBilledCostInUsdCents: z.string(),
  refundedCostInUsdCents: z.string(),
  netRefundedCostInUsdCents: z.string(),
};

const GroupedConsumptionSchema = z.object({
  timezone: z.literal("UTC"),
  since: z.string().nullable(),
  statuses: z.array(z.string()),
  groupBy: z.array(z.enum(["orgId", "brandId"])),
  days: z.array(
    z.object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      orgId: z.string().nullable(),
      brandId: z.string().nullable().optional(),
      ...FiguresSchema,
      ...MoneySchema,
    }),
  ),
});

export type GroupedConsumption = z.infer<typeof GroupedConsumptionSchema>;

/**
 * Every cost name since inception, per UTC day, grouped by org (and by brand with `withBrand`):
 * a co-branded run's row counts under EACH of its brands, so brand rows are never summed into
 * an org or fleet figure — those come from the org-grouped read.
 */
export async function fetchGroupedConsumption(withBrand: boolean): Promise<{ url: string; body: unknown; parsed: GroupedConsumption }> {
  const groupBy = withBrand ? "orgId,brandId" : "orgId";
  const result = await runsRead(`/internal/stats/costs/consumption?${new URLSearchParams({ groupBy }).toString()}`, GroupedConsumptionSchema);
  const expected = withBrand ? ["orgId", "brandId"] : ["orgId"];
  if (result.parsed.groupBy.join(",") !== expected.join(",")) {
    throw new RunsServiceError(`runs-service grouped by [${result.parsed.groupBy.join(",")}], asked for [${expected.join(",")}]`);
  }
  if (withBrand && result.parsed.days.some((d) => d.brandId === undefined)) {
    throw new RunsServiceError("runs-service answered a brand-grouped read without brandId on every row");
  }
  return result;
}

async function runsRead<T>(pathAndQuery: string, schema: z.ZodType<T>): Promise<{ url: string; body: unknown; parsed: T }> {
  const baseUrl = process.env.RUNS_SERVICE_URL;
  const apiKey = process.env.RUNS_SERVICE_API_KEY;
  const missing = [!baseUrl && "RUNS_SERVICE_URL", !apiKey && "RUNS_SERVICE_API_KEY"].filter(Boolean);
  if (missing.length > 0) {
    throw new RunsServiceError(`runs-service not configured: ${missing.join(" and ")} missing from costs-service env`);
  }
  const url = `${baseUrl!.replace(/\/+$/, "")}${pathAndQuery}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "x-api-key": apiKey!, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new RunsServiceError(`runs-service unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new RunsServiceError(`runs-service refused ${url}: HTTP ${res.status} ${text.slice(0, 300)}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RunsServiceError(`runs-service answered ${url} with non-JSON: ${text.slice(0, 300)}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new RunsServiceError(`runs-service answered ${url} in an unexpected shape: ${parsed.error.message.slice(0, 500)}`);
  }
  return { url, body, parsed: parsed.data };
}
