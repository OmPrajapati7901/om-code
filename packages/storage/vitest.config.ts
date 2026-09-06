import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // DoD-4: the suite runs offline. No network in any test; the keychain
    // tests inject a fake spawn (one optionally-skipped test uses the real
    // `security` binary only when OM_TEST_REAL_KEYCHAIN is set).
    environment: "node",
    testTimeout: 20_000,
  },
});
