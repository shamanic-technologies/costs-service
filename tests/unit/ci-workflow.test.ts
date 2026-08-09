import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Regression for the CI outage: the Test workflow cut an isolated Neon branch
// per run. The Neon project was deleted when the fleet moved to a self-hosted
// Postgres, so the step 404'd before a single test ran and every new PR was
// blocked on a required check that could never pass.
//
// The replacement must keep the property the Neon branch existed for: a
// database that belongs to this run alone and is gone when the job ends. These
// assertions fail red against the old workflow (Neon actions present, no
// service container) and against any future edit that points CI at a shared,
// staging or production database.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.resolve(__dirname, "../../.github/workflows/test.yml");
const workflow = readFileSync(WORKFLOW_PATH, "utf-8");

describe("CI test workflow", () => {
  it("has no Neon reference left anywhere", () => {
    expect(workflow.toLowerCase()).not.toContain("neondatabase/");
    expect(workflow).not.toContain("NEON_API_KEY");
    expect(workflow).not.toContain("NEON_PROJECT_ID");
  });

  it("provisions its own postgres service container", () => {
    expect(workflow).toMatch(/services:\s*\n\s*postgres:\s*\n\s*image: postgres:16/);
    expect(workflow).toContain("--health-cmd pg_isready");
  });

  it("points the test database URL at the service container, never a remote host", () => {
    const dbUrls = workflow.match(/postgresql:\/\/[^\s"']+/g) ?? [];
    expect(dbUrls.length).toBeGreaterThan(0);
    for (const url of dbUrls) {
      expect(url).toContain("@127.0.0.1:5432/");
    }
  });

  it("builds the schema by replaying the migration journal", () => {
    expect(workflow).toContain("npm run db:migrate");
  });

  it("fails the job when a drizzle-kit step reports an error but exits 0", () => {
    // `drizzle-kit push` prints `error:` and returns success, abandoning every
    // statement after the failure. Both schema steps must grep their own output.
    expect(workflow).toContain("set -o pipefail");
    expect(workflow).toContain("::error::");
  });
});
