/**
 * AC-3.3 end to end: the built `om` binary, not the functions behind it.
 *
 * This is the one place in the package that spawns a process. LRN-14's boundary
 * lint bans `node:child_process` outside `stub-client`/`storage`/`native`; test
 * files need an explicit exemption there, and this file is why.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const requireFromHere = createRequire(import.meta.url);
const manifest = requireFromHere("../package.json") as { version: string };

const packageRoot = join(import.meta.dirname, "..");
const repoRoot = join(packageRoot, "..", "..");
const binary = join(packageRoot, "dist", "om.js");

type Run = { stdout: string; stderr: string; status: number };

/**
 * Invokes the binary by path, not via `node <path>`, so the shebang and the
 * executable bit are exercised rather than described.
 */
function runBinary(args: readonly string[]): Run {
  try {
    const stdout = execFileSync(binary, args, {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      status: failure.status ?? -1,
    };
  }
}

beforeAll(() => {
  // Build here so the binary under test is always this source, whether the
  // suite runs alone or after `pnpm run build`. The workspace build also
  // produces @om-code/storage's dist, which the CLI imports.
  execFileSync("pnpm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
}, 120_000);

describe("the om binary", () => {
  it("prints the package version and exits 0", () => {
    const result = runBinary(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${manifest.version}\n`);
  });

  it("prints help and exits 0 with no arguments", () => {
    const result = runBinary([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("exits 1 on an unknown argument, with the message on stderr", () => {
    const result = runBinary(["--nope"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown argument");
  });
});
