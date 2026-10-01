CREATE TABLE IF NOT EXISTS "consumption_by_brand_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"org_id" text,
	"brand_id" text,
	"cost_name" text NOT NULL,
	"cost_source" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"billed_usd_cents" numeric(24, 10) NOT NULL,
	"net_billed_usd_cents" numeric(24, 10) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consumption_by_org_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"org_id" text,
	"cost_name" text NOT NULL,
	"cost_source" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"billed_usd_cents" numeric(24, 10) NOT NULL,
	"net_billed_usd_cents" numeric(24, 10) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payg_ratio_daily" (
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"cumulative_net_paid_usd_cents" bigint NOT NULL,
	"cumulative_vendor_recorded_usd_cents" numeric(24, 10) NOT NULL,
	"ratio" numeric(18, 10),
	CONSTRAINT "payg_ratio_daily_pk" PRIMARY KEY("day","provider")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payg_vendor_spend_daily" (
	"day" date NOT NULL,
	"vendor" text NOT NULL,
	"provider" text NOT NULL,
	"paid_usd_cents" bigint NOT NULL,
	"refunded_usd_cents" bigint NOT NULL,
	"payments" integer NOT NULL,
	"refunds" integer NOT NULL,
	CONSTRAINT "payg_vendor_spend_daily_pk" PRIMARY KEY("day","vendor")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "real_cost_raw_reads" (
	"read_on" date NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"body" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "real_cost_raw_reads_pk" PRIMARY KEY("read_on","source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "real_cost_refreshes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of" date NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"email_send_price_refresh_id" uuid,
	"subscription_cost_refresh_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "real_cost_refreshes_status" CHECK ("real_cost_refreshes"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "real_unit_costs_daily" (
	"day" date NOT NULL,
	"cost_name" text NOT NULL,
	"provider" text,
	"method" text NOT NULL,
	"flag" text,
	"real_cost_usd_cents" numeric(18, 10),
	"ratio" numeric(18, 10),
	"catalogue_vendor_cost_usd_cents" numeric(18, 10),
	"catalogue_price_usd_cents" numeric(18, 10),
	"multiplier" numeric(6, 2) NOT NULL,
	"proposed_price_usd_cents" numeric(18, 10),
	"proposed_basis" text NOT NULL,
	"refresh_id" uuid NOT NULL,
	CONSTRAINT "real_unit_costs_daily_pk" PRIMARY KEY("day","cost_name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_consumption_by_brand_daily_org_brand" ON "consumption_by_brand_daily" USING btree ("org_id","brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_consumption_by_org_daily_org" ON "consumption_by_org_daily" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_real_cost_refreshes_started" ON "real_cost_refreshes" USING btree ("started_at");