import { db, sql } from "../src/db/index.js";
import { costUnits } from "../src/db/schema.js";

const costs = [
  { name: "postmark-email-send", costPerUnitInUsdCents: "0.1800000000" },
];

async function seed() {
  for (const cost of costs) {
    const [row] = await db
      .insert(costUnits)
      .values({
        name: cost.name,
        costPerUnitInUsdCents: cost.costPerUnitInUsdCents,
      })
      .returning();
    console.log(`Seeded ${row.name} @ ${row.costPerUnitInUsdCents} ¢/unit`);
  }
  await sql.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
