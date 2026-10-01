CREATE TABLE IF NOT EXISTS "payg_vendor_parts_daily" (
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"part" text NOT NULL,
	"usd_cents" numeric(24, 10) NOT NULL,
	"basis" text NOT NULL,
	CONSTRAINT "payg_vendor_parts_daily_pk" PRIMARY KEY("day","provider","part")
);
--> statement-breakpoint
ALTER TABLE "payg_ratio_daily" ADD COLUMN "cumulative_metered_usd_cents" numeric(24, 10) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payg_ratio_daily" ADD COLUMN "numerator_basis" text DEFAULT 'ledger-net-paid' NOT NULL;