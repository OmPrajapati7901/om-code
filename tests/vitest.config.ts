import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["*.test.ts"],
    // AC-8.5: the shared guard fails the run if any test opens a socket.
    setupFiles: [fileURLToPath(new URL("./guards/no-network.mjs", import.meta.url))],
    environment: "node",
    testTimeout: 20_000,
  },
});
