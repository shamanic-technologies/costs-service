import { db, sql } from "../../src/db/index.js";
import { costUnits } from "../../src/db/schema.js";

export async function cleanTestData() {
  await db.delete(costUnits);
}

export async function insertTestCost(data: {
  name: string;
  costPerUnitInUsdCents: string;
  effectiveFrom?: Date;
}) {
  const [cost] = await db
    .insert(costUnits)
    .values({
      name: data.name,
      costPerUnitInUsdCents: data.costPerUnitInUsdCents,
      effectiveFrom: data.effectiveFrom || new Date(),
    })
    .returning();
  return cost;
}

export async function closeDb() {
  await sql.end();
}
