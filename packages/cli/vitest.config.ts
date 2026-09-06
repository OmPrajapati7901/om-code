import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // DoD-4: the suite runs offline. The shared guard (LRN-08, AC-8.5) fails
    // the run if any test opens a socket.
    setupFiles: [fileURLToPath(new URL("../../tests/guards/no-network.mjs", import.meta.url))],
    environment: "node",
    testTimeout: 20_000,
  },
});
