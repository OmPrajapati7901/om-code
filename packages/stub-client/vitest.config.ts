import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // DoD-4/AC-8.5: offline by construction, and the shared guard fails the
    // run if any test opens a socket (no loopback exception).
    setupFiles: [fileURLToPath(new URL("../../tests/guards/no-network.mjs", import.meta.url))],
    environment: "node",
    testTimeout: 20_000,
  },
});
