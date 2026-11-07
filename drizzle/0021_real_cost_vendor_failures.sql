ALTER TABLE "real_cost_refreshes" ADD COLUMN IF NOT EXISTS "vendor_failures" jsonb DEFAULT '[]'::jsonb NOT NULL;
