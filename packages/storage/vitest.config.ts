import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // DoD-4: the suite runs offline. No network in any test; the keychain
    // tests inject a fake spawn (one optionally-skipped test uses the real
    // `security` binary only when OM_TEST_REAL_KEYCHAIN is set). The shared
    // guard (LRN-08, AC-8.5) fails the run if any test opens a socket; the
    // journal-process child processes get it via `--import` instead.
    setupFiles: [fileURLToPath(new URL("../../tests/guards/no-network.mjs", import.meta.url))],
    environment: "node",
    testTimeout: 20_000,
  },
});
