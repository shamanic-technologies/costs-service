import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.COSTS_SERVICE_DATABASE_URL;

if (!connectionString) {
  throw new Error("COSTS_SERVICE_DATABASE_URL is not set");
}

export const sql = postgres(connectionString, { prepare: false });
export const db = drizzle(sql, { schema });

// Direct (non-pooler) connection for seed operations.
// pgbouncer transaction mode can silently drop writes; the seed runs once
// at startup so a direct connection is safe and avoids pooler issues.
const directConnectionString = connectionString.replace("-pooler.", ".");
export const directSql = postgres(directConnectionString, { prepare: false });
