/**
 * AC-4.3 — the credential value never appears in any file we write
 * (LRN-04, LR-FR-030).
 *
 * A sentinel secret is placed in a fake env and a fake keychain, load runs
 * against a temp OM_HOME, then the whole tree plus the redaction behaviour of
 * the credential wrapper are asserted sentinel-free. assertNoSecret is written
 * as a reusable helper so LRN-06 (journal) and LRN-11 (logs) extend the same
 * guard. LRN-04 itself writes zero bytes: loadSettings must not create files.
 */

import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { loadSettings } from "../src/config/loader.js";
import { assertNoSecret } from "./helpers/secret-guard.js";

const SENTINEL = "sk-sentinel-secret-7f3a9c-do-not-log";

function snapshotFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    found.push(path);
    if (statSync(path).isDirectory()) {
      found.push(...snapshotFiles(path));
    }
  }
  return found.sort();
}

describe("AC-4.3 — no secret on disk", () => {
  it("env-sourced secrets never touch the OM_HOME tree", () => {
    const omHome = mkdtempSync(join(tmpdir(), "om-home-"));
    writeFileSync(
      join(omHome, "config.json"),
      JSON.stringify({
        baseUrl: "https://api.example.com/v1",
        model: "test-model",
        credential: "env:SENTINEL_API_KEY",
      }),
    );
    const before = snapshotFiles(omHome);
    const resolved = loadSettings({
      env: { OM_HOME: omHome, SENTINEL_API_KEY: SENTINEL },
      cwd: tmpdir(),
    });
    // The secret really resolved — otherwise this test would be vacuous.
    expect(resolved.credential.secret.unwrap()).toBe(SENTINEL);
    expect(snapshotFiles(omHome)).toEqual(before);
    assertNoSecret(omHome, SENTINEL);
  });

  it("keychain-sourced secrets never touch the OM_HOME tree", () => {
    const omHome = mkdtempSync(join(tmpdir(), "om-home-"));
    writeFileSync(
      join(omHome, "config.json"),
      JSON.stringify({
        baseUrl: "https://api.example.com/v1",
        model: "test-model",
        credential: "keychain:om-test-service/om-test-account",
      }),
    );
    const resolved = loadSettings({
      env: { OM_HOME: omHome },
      cwd: tmpdir(),
      runKeychain: () => ({ status: 0, stdout: `${SENTINEL}\n` }),
    });
    expect(resolved.credential.secret.unwrap()).toBe(SENTINEL);
    assertNoSecret(omHome, SENTINEL);
  });

  it("every stringification of the credential wrapper redacts", () => {
    const omHome = mkdtempSync(join(tmpdir(), "om-home-"));
    const resolved = loadSettings({
      env: { OM_HOME: omHome, SENTINEL_API_KEY: SENTINEL },
      cwd: tmpdir(),
      flags: {
        baseUrl: "https://api.example.com/v1",
        model: "m",
        credential: "env:SENTINEL_API_KEY",
      },
    });
    const secret = resolved.credential.secret;
    expect(JSON.stringify(secret)).not.toContain(SENTINEL);
    expect(`${secret}`).not.toContain(SENTINEL);
    expect(`prefix ${secret} suffix`).not.toContain(SENTINEL);
    expect(String(secret)).not.toContain(SENTINEL);
    expect(inspect(secret)).not.toContain(SENTINEL);
    expect(JSON.stringify({ credential: secret })).not.toContain(SENTINEL);
  });
});
