import express from "express";
import cors from "cors";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import healthRoutes from "./routes/health.js";
import costsRoutes from "./routes/costs.js";
import { db } from "./db/index.js";
import { seedCosts } from "./db/seed.js";

const app = express();
const PORT = process.env.PORT || 3011;

app.use(cors());
app.use(express.json());

app.use(healthRoutes);
app.use(costsRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Only start server if not in test environment
if (process.env.NODE_ENV !== "test") {
  migrate(db, { migrationsFolder: "./drizzle" })
    .then(() => {
      console.log("[Costs Service] Migrations complete");
      return seedCosts();
    })
    .then(() => {
      app.listen(Number(PORT), "::", () => {
        console.log(`[Costs Service] Service running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error("[Costs Service] Migration failed:", err);
      process.exit(1);
    });
}

export default app;
