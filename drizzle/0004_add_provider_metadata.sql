-- Add provider metadata columns for the public pricing page (logo.dev domain,
-- explicit cost type, and human-readable unit). Adds nullable, backfills from
-- the seed-aligned (name, provider) catalog, then locks NOT NULL on type/unit.

ALTER TABLE "providers_costs" ADD COLUMN IF NOT EXISTS "provider_domain" text;--> statement-breakpoint
ALTER TABLE "providers_costs" ADD COLUMN IF NOT EXISTS "type" text;--> statement-breakpoint
ALTER TABLE "providers_costs" ADD COLUMN IF NOT EXISTS "unit" text;--> statement-breakpoint

-- Backfill provider_domain by provider (only set when still NULL — idempotent).
UPDATE "providers_costs" SET "provider_domain" = 'apollo.io'       WHERE "provider" = 'apollo'      AND "provider_domain" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "provider_domain" = 'anthropic.com'   WHERE "provider" = 'anthropic'   AND "provider_domain" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "provider_domain" = 'firecrawl.dev'   WHERE "provider" = 'firecrawl'   AND "provider_domain" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "provider_domain" = 'google.com'      WHERE "provider" = 'google'      AND "provider_domain" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "provider_domain" = 'instantly.ai'    WHERE "provider" = 'instantly'   AND "provider_domain" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "provider_domain" = 'postmarkapp.com' WHERE "provider" = 'postmark'    AND "provider_domain" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "provider_domain" = 'scrape.do'       WHERE "provider" = 'scrape-do'   AND "provider_domain" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "provider_domain" = 'serper.dev'      WHERE "provider" = 'serper-dev'  AND "provider_domain" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "provider_domain" = 'twilio.com'      WHERE "provider" = 'twilio'      AND "provider_domain" IS NULL;--> statement-breakpoint

-- Backfill type and unit by name (only set when still NULL — idempotent).
UPDATE "providers_costs" SET "type" = 'Credit', "unit" = 'credit' WHERE "name" = 'apollo-credit' AND "type" IS NULL;--> statement-breakpoint

UPDATE "providers_costs" SET "type" = 'Input tokens (Opus 4.5)',    "unit" = '1M tokens' WHERE "name" = 'anthropic-opus-4.5-tokens-input'    AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Opus 4.5)',   "unit" = '1M tokens' WHERE "name" = 'anthropic-opus-4.5-tokens-output'   AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Sonnet 4.5)',  "unit" = '1M tokens' WHERE "name" = 'anthropic-sonnet-4.5-tokens-input'  AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Sonnet 4.5)', "unit" = '1M tokens' WHERE "name" = 'anthropic-sonnet-4.5-tokens-output' AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Sonnet 4.6)',  "unit" = '1M tokens' WHERE "name" = 'anthropic-sonnet-4.6-tokens-input'  AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Sonnet 4.6)', "unit" = '1M tokens' WHERE "name" = 'anthropic-sonnet-4.6-tokens-output' AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Opus 4.6)',    "unit" = '1M tokens' WHERE "name" = 'anthropic-opus-4.6-tokens-input'    AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Opus 4.6)',   "unit" = '1M tokens' WHERE "name" = 'anthropic-opus-4.6-tokens-output'   AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Haiku 4.5)',   "unit" = '1M tokens' WHERE "name" = 'anthropic-haiku-4.5-tokens-input'   AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Haiku 4.5)',  "unit" = '1M tokens' WHERE "name" = 'anthropic-haiku-4.5-tokens-output'  AND "type" IS NULL;--> statement-breakpoint

UPDATE "providers_costs" SET "type" = 'Email send', "unit" = 'email' WHERE "name" = 'postmark-email-send' AND "type" IS NULL;--> statement-breakpoint

UPDATE "providers_costs" SET "type" = 'Scrape credit', "unit" = 'credit' WHERE "name" = 'firecrawl-scrape-credit' AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Map credit',    "unit" = 'credit' WHERE "name" = 'firecrawl-map-credit'    AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Extract token', "unit" = 'token'  WHERE "name" = 'firecrawl-extract-token' AND "type" IS NULL;--> statement-breakpoint

UPDATE "providers_costs" SET "type" = 'Input tokens (Gemini 3 Flash)',          "unit" = '1M tokens' WHERE "name" = 'google-flash-3-tokens-input'         AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Gemini 3 Flash)',         "unit" = '1M tokens' WHERE "name" = 'google-flash-3-tokens-output'        AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Gemini 3.1 Flash Lite)',   "unit" = '1M tokens' WHERE "name" = 'google-flash-lite-3.1-tokens-input'  AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Gemini 3.1 Flash Lite)',  "unit" = '1M tokens' WHERE "name" = 'google-flash-lite-3.1-tokens-output' AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Gemini 3.1 Pro)',          "unit" = '1M tokens' WHERE "name" = 'google-pro-3.1-tokens-input'         AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Gemini 3.1 Pro)',         "unit" = '1M tokens' WHERE "name" = 'google-pro-3.1-tokens-output'        AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Gemini 2.5 Pro)',          "unit" = '1M tokens' WHERE "name" = 'google-pro-2.5-tokens-input'         AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Gemini 2.5 Pro)',         "unit" = '1M tokens' WHERE "name" = 'google-pro-2.5-tokens-output'        AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Gemini 2.5 Flash)',        "unit" = '1M tokens' WHERE "name" = 'google-flash-2.5-tokens-input'       AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Gemini 2.5 Flash)',       "unit" = '1M tokens' WHERE "name" = 'google-flash-2.5-tokens-output'      AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Input tokens (Gemini 2.5 Flash-Lite)',   "unit" = '1M tokens' WHERE "name" = 'google-flash-lite-2.5-tokens-input'  AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Output tokens (Gemini 2.5 Flash-Lite)',  "unit" = '1M tokens' WHERE "name" = 'google-flash-lite-2.5-tokens-output' AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Search query (grounding)',               "unit" = 'query'     WHERE "name" = 'google-search-query'                  AND "type" IS NULL;--> statement-breakpoint

UPDATE "providers_costs" SET "type" = 'Contact upload',           "unit" = 'contact' WHERE "name" = 'instantly-contact-uploaded'    AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Email send (per account)', "unit" = 'email'   WHERE "name" = 'instantly-account-email-sent'  AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Email send (per domain)',  "unit" = 'email'   WHERE "name" = 'instantly-domain-email-sent'   AND "type" IS NULL;--> statement-breakpoint

UPDATE "providers_costs" SET "type" = 'Search query',  "unit" = 'query'  WHERE "name" = 'serper-dev-query' AND "type" IS NULL;--> statement-breakpoint
UPDATE "providers_costs" SET "type" = 'Scrape credit', "unit" = 'credit' WHERE "name" = 'scrape-do-credit' AND "type" IS NULL;--> statement-breakpoint

UPDATE "providers_costs" SET "type" = 'SMS message', "unit" = 'segment' WHERE "name" = 'twilio-sms-segment' AND "type" IS NULL;--> statement-breakpoint

-- Fail loud if any row was missed: the migration will not lock NOT NULL with stale data.
DO $migration_check$
DECLARE
  null_count integer;
  null_names text;
BEGIN
  SELECT count(*), string_agg(DISTINCT name, ', ')
    INTO null_count, null_names
  FROM "providers_costs" WHERE "type" IS NULL OR "unit" IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration 0004: % providers_costs rows still have NULL type/unit. Names: %. Add a backfill clause for each before re-running.', null_count, null_names;
  END IF;
END
$migration_check$;--> statement-breakpoint

ALTER TABLE "providers_costs" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providers_costs" ALTER COLUMN "unit" SET NOT NULL;
