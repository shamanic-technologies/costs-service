import { pgTable, uuid, text, timestamp, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";

export const costUnits = pgTable(
  "cost_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    costPerUnitInUsdCents: numeric("cost_per_unit_in_usd_cents", { precision: 12, scale: 10 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_cost_units_name_effective").on(table.name, table.effectiveFrom),
    index("idx_cost_units_name").on(table.name),
  ]
);

export type CostUnit = typeof costUnits.$inferSelect;
export type NewCostUnit = typeof costUnits.$inferInsert;
