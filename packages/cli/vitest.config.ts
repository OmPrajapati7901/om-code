import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // DoD-4: the suite runs offline. Nothing here reaches the network, and the
    // suite-level socket guard that proves it lands in LRN-08 (AC-8.5).
    environment: "node",
    testTimeout: 20_000,
  },
});
