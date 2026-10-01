CREATE TABLE IF NOT EXISTS "email_infra_spend_daily" (
	"day" date NOT NULL,
	"vendor" text NOT NULL,
	"paid_usd_cents" bigint NOT NULL,
	"refunded_usd_cents" bigint NOT NULL,
	"payments" integer NOT NULL,
	"refunds" integer NOT NULL,
	CONSTRAINT "email_infra_spend_daily_pk" PRIMARY KEY("day","vendor")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_send_price_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"spend_usd_cents" bigint NOT NULL,
	"emails_to_leads" integer NOT NULL,
	"cumulative_spend_usd_cents" bigint NOT NULL,
	"cumulative_emails_to_leads" integer NOT NULL,
	"price_usd_cents" numeric(14, 4),
	"month_to_date_spend_usd_cents" bigint NOT NULL,
	"month_to_date_emails_to_leads" integer NOT NULL,
	"month_price_usd_cents" numeric(14, 4),
	"refresh_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_send_price_raw_reads" (
	"read_on" date NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"body" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_send_price_raw_reads_pk" PRIMARY KEY("read_on","source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_send_price_refreshes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of" date NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "email_send_price_refreshes_status" CHECK ("email_send_price_refreshes"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emails_to_leads_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"to_leads" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_send_price_refreshes_started" ON "email_send_price_refreshes" USING btree ("started_at");