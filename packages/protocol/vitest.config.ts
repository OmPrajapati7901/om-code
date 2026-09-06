import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // DoD-4: pure schemas, no I/O of any kind — offline by construction.
    environment: "node",
    testTimeout: 20_000,
  },
});
