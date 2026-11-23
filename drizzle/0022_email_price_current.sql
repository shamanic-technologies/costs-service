ALTER TABLE "email_send_price_daily" ADD COLUMN IF NOT EXISTS "running_cost_usd_cents_per_day" numeric(14, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_send_price_daily" ADD COLUMN IF NOT EXISTS "trailing_emails_per_day" numeric(14, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_send_price_daily" ADD COLUMN IF NOT EXISTS "since_inception_price_usd_cents" numeric(14, 4);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_infra_spend_coverage" (
	"line_id" text PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"booked_on" date NOT NULL,
	"net_usd_cents" bigint NOT NULL,
	"covers_from" date NOT NULL,
	"covers_until" date NOT NULL,
	"basis" text NOT NULL
);
