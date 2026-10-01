CREATE TABLE IF NOT EXISTS "subscription_consumption_daily" (
	"day" date NOT NULL,
	"cost_name" text NOT NULL,
	"cost_source" text NOT NULL,
	"quantity_micros" bigint NOT NULL,
	"refunded_quantity_micros" bigint NOT NULL,
	CONSTRAINT "subscription_consumption_daily_pk" PRIMARY KEY("day","cost_name","cost_source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_cost_daily" (
	"day" date NOT NULL,
	"subscription" text NOT NULL,
	"paid_usd_cents" bigint,
	"refunded_usd_cents" bigint,
	"net_usd_cents" bigint,
	"credits_micros" bigint NOT NULL,
	"cumulative_paid_usd_cents" bigint,
	"cumulative_refunded_usd_cents" bigint,
	"cumulative_net_usd_cents" bigint,
	"cumulative_credits_micros" bigint NOT NULL,
	"cost_per_credit_usd_cents" numeric(18, 6),
	"gross_cost_per_credit_usd_cents" numeric(18, 6),
	"refresh_id" uuid NOT NULL,
	CONSTRAINT "subscription_cost_daily_pk" PRIMARY KEY("day","subscription")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_cost_raw_reads" (
	"read_on" date NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"body" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_cost_raw_reads_pk" PRIMARY KEY("read_on","source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_cost_refreshes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of" date NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "subscription_cost_refreshes_status" CHECK ("subscription_cost_refreshes"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_spend_daily" (
	"day" date NOT NULL,
	"vendor" text NOT NULL,
	"paid_usd_cents" bigint NOT NULL,
	"refunded_usd_cents" bigint NOT NULL,
	"payments" integer NOT NULL,
	"refunds" integer NOT NULL,
	CONSTRAINT "subscription_spend_daily_pk" PRIMARY KEY("day","vendor")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscription_cost_refreshes_started" ON "subscription_cost_refreshes" USING btree ("started_at");