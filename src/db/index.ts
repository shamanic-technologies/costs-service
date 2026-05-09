import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.COSTS_SERVICE_DATABASE_URL;

if (!connectionString) {
  throw new Error("COSTS_SERVICE_DATABASE_URL is not set");
}

// Pooled client for the request path. Explicit limits required:
// - max: per-instance cap on Neon pooler connections. Cloud Run autoscale
//   multiplies this by replica count, so keep it small.
// - idle_timeout: reap idle conns so they don't sit on Neon's permit cap.
// - connect_timeout: fail fast instead of stacking acquire attempts when the
//   pool is saturated (the "Too many database connection attempts" mode).
export const sql = postgres(connectionString, {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(sql, { schema });

// Direct (non-pooler) URL for seed operations: pgbouncer transaction mode can
// silently drop multi-statement writes. Exported as a string so the seed can
// open and close its own short-lived client per call — keeping a module-level
// direct client open leaks a Neon compute slot per Cloud Run instance.
export const directConnectionString = connectionString.replace("-pooler.", ".");
