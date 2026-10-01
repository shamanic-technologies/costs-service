ALTER TABLE "email_infra_spend_daily" ADD COLUMN "vat_paid_usd_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_infra_spend_daily" ADD COLUMN "vat_refunded_usd_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_infra_spend_daily" ADD COLUMN "vat_basis" text;--> statement-breakpoint
ALTER TABLE "payg_vendor_spend_daily" ADD COLUMN "vat_paid_usd_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payg_vendor_spend_daily" ADD COLUMN "vat_refunded_usd_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payg_vendor_spend_daily" ADD COLUMN "vat_basis" text;--> statement-breakpoint
ALTER TABLE "subscription_spend_daily" ADD COLUMN "vat_paid_usd_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_spend_daily" ADD COLUMN "vat_refunded_usd_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_spend_daily" ADD COLUMN "vat_basis" text;