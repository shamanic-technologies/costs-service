import { db } from "./index.js";
import { costUnits } from "./schema.js";

const SEED_COSTS = [
  {
    name: "postmark-email-send",
    costPerUnitInUsdCents: "0.1800000000",
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  },
];

export async function seedCosts() {
  for (const cost of SEED_COSTS) {
    await db
      .insert(costUnits)
      .values(cost)
      .onConflictDoNothing();
  }
  console.log(`Seed complete (${SEED_COSTS.length} cost(s) checked)`);
}
