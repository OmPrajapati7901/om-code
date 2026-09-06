/**
 * AC-5.6 without dependency-cruiser: that tool does not exist until LRN-14,
 * and DoD-3 says that until it lands the gate means "the checks that exist,
 * run locally". So this test reads packages/protocol/package.json and
 * asserts no @om-code/* dependency, then scans every .ts file under src/ for an
 * import specifier starting with @om-code/ or node:. LRN-14 replaces this
 * with the real rule; this test stays as a fast local signal.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function listTsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...listTsFiles(path));
      continue;
    }
    if (path.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

const SPECIFIER_PATTERN =
  /(?:import|export)[^'"]*from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']/g;

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

  it("imports neither workspace packages nor node: builtins from src", () => {
    const violations: string[] = [];
    for (const file of listTsFiles(join(PACKAGE_DIR, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(SPECIFIER_PATTERN)) {
        const specifier = match[1] ?? match[2] ?? "";
        if (specifier.startsWith("@om-code/") || specifier.startsWith("node:")) {
          violations.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
