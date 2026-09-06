/**
 * DoD-2 — the failure path for credential resolution (LRN-04).
 *
 * A keychain lookup that returns non-zero (item not found) resolves to
 * "unresolved", not a crash. No network in any test: the spawn is injected,
 * and the one test that exercises the real `security` binary runs only when
 * OM_TEST_REAL_KEYCHAIN is set.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveCredentialSecret } from "../src/config/credential.js";
import { parseCredentialReference } from "../src/config/settings.js";

describe("credential failure paths", () => {
  it("a missing keychain item resolves to unresolved, not a crash", () => {
    const secret = resolveCredentialSecret("keychain:no-such-service/no-such-account", {}, () => ({
      status: 44,
      stdout: "",
    }));
    expect(secret).toBeUndefined();
  });

  it("a missing env variable resolves to unresolved, not a crash", () => {
    expect(
      resolveCredentialSecret("env:OM_DEFINITELY_UNSET_VAR", {}, () => ({ status: 0, stdout: "" })),
    ).toBeUndefined();
  });

  it("an empty env value resolves to unresolved", () => {
    expect(
      resolveCredentialSecret("env:OM_EMPTY_VAR", { OM_EMPTY_VAR: "" }, () => ({
        status: 0,
        stdout: "",
      })),
    ).toBeUndefined();
  });

  it("a malformed reference resolves to unresolved (validation reports it elsewhere)", () => {
    expect(
      resolveCredentialSecret("bogus", {}, () => ({ status: 0, stdout: "x" })),
    ).toBeUndefined();
  });

  it("keychain output has one trailing newline stripped, empty output is unresolved", () => {
    expect(
      resolveCredentialSecret("keychain:s/a", {}, () => ({ status: 0, stdout: "sekret\n" })),
    ).toBe("sekret");
    expect(
      resolveCredentialSecret("keychain:s/a", {}, () => ({ status: 0, stdout: "\n" })),
    ).toBeUndefined();
  });

  it("reference parsing rejects unknown schemes", () => {
    expect(() => parseCredentialReference("file:/tmp/key", "<test>")).toThrowError(/env:<VAR>/);
    expect(() => parseCredentialReference("env:", "<test>")).toThrowError(/env:<VAR>/);
    expect(() => parseCredentialReference("keychain:only-service", "<test>")).toThrowError(
      /keychain:<service>\/<account>/,
    );
  });

  it.skipIf(process.env.OM_TEST_REAL_KEYCHAIN === undefined)(
    "exercises the real `security` binary when OM_TEST_REAL_KEYCHAIN is set",
    () => {
      const probe = execFileSync("security", ["list-keychains"], { encoding: "utf8" });
      expect(typeof probe).toBe("string");
      const missing = resolveCredentialSecret(
        "keychain:om-nonexistent-service/om-nonexistent-account",
        process.env,
      );
      expect(missing).toBeUndefined();
    },
  );
});
