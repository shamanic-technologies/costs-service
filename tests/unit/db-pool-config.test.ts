import { describe, it, expect } from "vitest";
import * as dbModule from "../../src/db/index.js";
import { sql } from "../../src/db/index.js";

describe("db pool configuration (regression: prod connection exhaustion)", () => {
  it("does not export a module-level directSql client (leak prevention)", () => {
    // Regression: prior to fix, `directSql` was a module-level postgres client
    // that opened a non-pooler direct Neon connection at process start and was
    // never `.end()`'d. Each Cloud Run instance held a direct compute slot for
    // its lifetime, exhausting Neon's connection cap under autoscale and
    // surfacing as `XX000 Failed to acquire permit` / `CONNECT_TIMEOUT`.
    expect((dbModule as Record<string, unknown>).directSql).toBeUndefined();
  });

  it("pooled sql client has explicit max connections set", () => {
    const opts = (sql as unknown as { options: { max: number } }).options;
    expect(opts.max).toBeGreaterThan(0);
    expect(opts.max).toBeLessThanOrEqual(5);
  });

  it("pooled sql client has explicit idle_timeout set", () => {
    const opts = (sql as unknown as { options: { idle_timeout: number } }).options;
    expect(opts.idle_timeout).toBeGreaterThan(0);
  });

  it("pooled sql client has explicit connect_timeout set", () => {
    const opts = (sql as unknown as { options: { connect_timeout: number } }).options;
    expect(opts.connect_timeout).toBeGreaterThan(0);
  });
});
