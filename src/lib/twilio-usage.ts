import { z } from "zod";

/**
 * What Twilio itself says our account CONSUMED, per day and usage category, and the prepaid balance
 * left on it — read from Twilio's own Usage Records and Balance APIs with the platform credential
 * (key-service, provider `twilio`, a JSON `{ accountSid, authToken }`).
 *
 * Twilio is prepaid: a bank line to Twilio is a balance top-up, and the balance then pays both the
 * metered usage our runs record (minutes, messages) and the phone-number rental. So the bank ledger
 * alone cannot say what a minute cost us; Twilio's usage records can.
 *
 * Unconfigured, unreachable, refused, non-USD or unrecognised = `TwilioUsageError`, never zero usage.
 */

const TIMEOUT_MS = 30_000;
const TWILIO_API = "https://api.twilio.com";

export class TwilioUsageError extends Error {}

const UsageRecordSchema = z.object({
  category: z.string(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.union([z.string(), z.number()]).nullable(),
  price_unit: z.string().nullable(),
});

const UsagePageSchema = z.object({
  usage_records: z.array(UsageRecordSchema),
  next_page_uri: z.string().nullable(),
});

const BalanceSchema = z.object({ balance: z.string(), currency: z.string() });
const AccountSchema = z.object({ sid: z.string(), friendly_name: z.string() });

export type TwilioDailyUsage = { day: string; category: string; usdCents: number };

export type TwilioUsage = {
  /** One entry per (day, category) asked for, price in US cents (0 when Twilio reports none). */
  daily: TwilioDailyUsage[];
  /** Prepaid balance left on the account right now, US cents. */
  balanceUsdCents: number;
  /** Raw Twilio bodies, kept as bronze. No credential in them. */
  raw: unknown;
};

async function platformCredentials(): Promise<{ accountSid: string; authToken: string }> {
  const baseUrl = process.env.KEY_SERVICE_URL;
  const apiKey = process.env.KEY_SERVICE_API_KEY;
  const missing = [!baseUrl && "KEY_SERVICE_URL", !apiKey && "KEY_SERVICE_API_KEY"].filter(Boolean);
  if (missing.length > 0) throw new TwilioUsageError(`Twilio usage needs key-service: ${missing.join(" and ")} missing from costs-service env`);
  const path = "/keys/platform/twilio/decrypt";
  let res: Response;
  try {
    res = await fetch(`${baseUrl!.replace(/\/+$/, "")}${path}`, {
      headers: { "x-api-key": apiKey!, "x-caller-service": "costs-service", "x-caller-method": "GET", "x-caller-path": path },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new TwilioUsageError(`key-service unreachable for the Twilio platform key: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new TwilioUsageError(`key-service refused the Twilio platform key: HTTP ${res.status} ${text.slice(0, 300)}`);
  let creds: { accountSid?: unknown; authToken?: unknown };
  try {
    creds = JSON.parse(JSON.parse(text).key);
  } catch {
    throw new TwilioUsageError("The Twilio platform key is not a JSON { accountSid, authToken }");
  }
  if (typeof creds.accountSid !== "string" || typeof creds.authToken !== "string" || !creds.accountSid || !creds.authToken) {
    throw new TwilioUsageError("The Twilio platform key misses accountSid and/or authToken");
  }
  return { accountSid: creds.accountSid, authToken: creds.authToken };
}

async function twilioGet<T>(path: string, auth: string, schema: z.ZodType<T>): Promise<{ body: unknown; data: T }> {
  let res: Response;
  try {
    res = await fetch(`${TWILIO_API}${path}`, { headers: { Authorization: auth, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new TwilioUsageError(`Twilio unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new TwilioUsageError(`Twilio refused ${path.split("?")[0].replace(/AC[0-9a-f]{32}/, "<account>")}: HTTP ${res.status} ${text.slice(0, 300)}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TwilioUsageError(`Twilio answered with non-JSON: ${text.slice(0, 300)}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new TwilioUsageError(`Twilio answered in an unexpected shape: ${parsed.error.message.slice(0, 500)}`);
  return { body, data: parsed.data };
}

/** Daily price of each named usage category from `since` through `until` (inclusive), and the balance now. */
export async function fetchTwilioUsage(accountName: string, categories: readonly string[], since: string, until: string): Promise<TwilioUsage> {
  const { accountSid, authToken } = await platformCredentials();
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const account = `/2010-04-01/Accounts/${accountSid}`;
  // Only the declared account's spend counts: refuse to read another one's usage as ours.
  const { data: acct } = await twilioGet(`${account}.json`, auth, AccountSchema);
  if (acct.friendly_name !== accountName) {
    throw new TwilioUsageError(`The Twilio platform key opens account '${acct.friendly_name}', not the declared '${accountName}'`);
  }

  const daily: TwilioDailyUsage[] = [];
  const raw: { category: string; pages: unknown[] }[] = [];
  for (const category of categories) {
    const pages: unknown[] = [];
    let path: string | null = `${account}/Usage/Records/Daily.json?${new URLSearchParams({ Category: category, StartDate: since, EndDate: until, PageSize: "1000" })}`;
    while (path) {
      const { body, data }: { body: unknown; data: z.infer<typeof UsagePageSchema> } = await twilioGet(path, auth, UsagePageSchema);
      pages.push(body);
      for (const r of data.usage_records) {
        if (r.category !== category) throw new TwilioUsageError(`Twilio answered category '${r.category}' when asked for '${category}'`);
        const price = r.price === null ? 0 : Number(r.price);
        if (!Number.isFinite(price)) throw new TwilioUsageError(`Twilio price '${r.price}' for ${category} on ${r.start_date} is not a number`);
        if (price !== 0 && r.price_unit?.toLowerCase() !== "usd") throw new TwilioUsageError(`Twilio priced ${category} in '${r.price_unit}', only USD is understood`);
        daily.push({ day: r.start_date, category, usdCents: Math.round(price * 100 * 1e6) / 1e6 });
      }
      path = data.next_page_uri;
    }
    raw.push({ category, pages });
  }

  const { body: balanceBody, data: balance } = await twilioGet(`${account}/Balance.json`, auth, BalanceSchema);
  if (balance.currency.toUpperCase() !== "USD") throw new TwilioUsageError(`Twilio balance is in '${balance.currency}', only USD is understood`);
  const balanceUsd = Number(balance.balance);
  if (!Number.isFinite(balanceUsd)) throw new TwilioUsageError(`Twilio balance '${balance.balance}' is not a number`);
  const { account_sid: _sid, ...balanceRaw } = balanceBody as Record<string, unknown>;

  return { daily, balanceUsdCents: Math.round(balanceUsd * 100 * 1e6) / 1e6, raw: { usage: raw, balance: balanceRaw } };
}
