CREATE TABLE IF NOT EXISTS "payment_sources" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_sources_key_format" CHECK ("payment_sources"."key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_payment_sources" (
	"provider" text NOT NULL,
	"source_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_payment_sources_pk" PRIMARY KEY("provider","source_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_payment_sources" ADD CONSTRAINT "provider_payment_sources_source_fk" FOREIGN KEY ("source_key") REFERENCES "public"."payment_sources"("key") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "payment_sources" ("key", "display_name", "domain") VALUES
	('revolut_business', 'Revolut Business', 'revolut.com'),
	('revolut_personal', 'Revolut Personal', 'revolut.com'),
	('stripe', 'Stripe', 'stripe.com'),
	('qonto', 'Qonto', 'qonto.com')
ON CONFLICT ("key") DO NOTHING;
