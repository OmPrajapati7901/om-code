import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // AC-9.4: assembly is pure, so the shared no-network guard costs nothing.
    setupFiles: [fileURLToPath(new URL("../../tests/guards/no-network.mjs", import.meta.url))],
    environment: "node",
    testTimeout: 20_000,
  },
});
