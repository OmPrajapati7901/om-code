/**
 * AC-5.6, manifest half: `packages/protocol` declares no `@om-code/*`
 * dependency. Direction on the real import graph is `protocol-is-a-leaf` in
 * `.dependency-cruiser.cjs` (LRN-14); the old source-scan half of this test
 * was redundant with it. This stays as a fast local signal that also catches
 * declared-but-unused workspace deps, which dependency-cruiser cannot see.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("isolation (AC-5.6)", () => {
  it("declares no workspace dependency", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const section of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      const names = Object.keys(manifest[section] ?? {});
      expect(names.filter((name) => name.startsWith("@om-code/"))).toEqual([]);
    }
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(["zod"]);
  });
});
