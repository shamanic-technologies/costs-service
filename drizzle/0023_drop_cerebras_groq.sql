-- OPEN-LLM-DROP-1124: Cerebras and Groq were seeded on 2026-11-24 (v0.89.0) and dropped the same
-- day (owner: « delete dead code »; OpenRouter serves the same open models cheaper). No key was
-- ever registered, so no spend was ever declared under these names: deleting their catalogue rows
-- loses no history. Any future spend under a deleted name would fail loud (unknown cost name).
DELETE FROM "provider_cost_vendor_costs" WHERE "provider_cost_id" IN (SELECT "id" FROM "providers_costs" WHERE "name" ~ '^(cerebras|groq)-');--> statement-breakpoint
DELETE FROM "providers_costs" WHERE "name" ~ '^(cerebras|groq)-';--> statement-breakpoint
DELETE FROM "platform_costs" WHERE "provider" IN ('cerebras', 'groq');
