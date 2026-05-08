import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    fileParallelism: false,
    maxWorkers: 1,
    // Bump hook timeout to 30s. Default 10s trips on Neon pooler latency in
    // CI when integration tests run cleanTestData() in beforeEach
    // (observed in v0.16.4 staging promote, run 25552926621 — beforeEach
    // hook timed out at 10000ms in providers-costs.test.ts).
    hookTimeout: 30_000,
  },
});
