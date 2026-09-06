import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import type { HostPlatform } from "../src/platform.js";
import { readVersion } from "../src/version.js";

const requireFromHere = createRequire(import.meta.url);
const manifest = requireFromHere("../package.json") as { version: string };

const SUPPORTED: HostPlatform = { platform: "darwin", arch: "arm64" };
const UNSUPPORTED: HostPlatform = { platform: "linux", arch: "x64" };

describe("AC-3.3 — om --version", () => {
  it("prints the version declared in package.json", () => {
    const result = runCli(["--version"], SUPPORTED);
    expect(result.stdout).toBe(`${manifest.version}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("resolves that version through readVersion, so there is one source", () => {
    expect(readVersion()).toBe(manifest.version);
  });

  it("accepts the -v alias", () => {
    expect(runCli(["-v"], SUPPORTED).stdout).toBe(`${manifest.version}\n`);
  });
});

describe("AC-3.4 — the guard runs before any command", () => {
  it("refuses --version on an unsupported host with exit 1", () => {
    const result = runCli(["--version"], UNSUPPORTED);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("linux/x64");
  });

  it("refuses --help on an unsupported host too — nothing proceeds silently", () => {
    const result = runCli(["--help"], UNSUPPORTED);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("refuses an unsupported host with no arguments at all", () => {
    const result = runCli([], UNSUPPORTED);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unsupported host");
  });
});

describe("help and argument errors", () => {
  it("prints help with no arguments and exits 0", () => {
    const result = runCli([], SUPPORTED);
    expect(result.stdout).toContain("Usage:");
    expect(result.exitCode).toBe(0);
  });

  it("prints help for --help and -h", () => {
    expect(runCli(["--help"], SUPPORTED).stdout).toContain("Usage:");
    expect(runCli(["-h"], SUPPORTED).stdout).toContain("Usage:");
  });

  it("exits 1 on an unknown argument and says so on stderr", () => {
    const result = runCli(["--nope"], SUPPORTED);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('unknown argument "--nope"');
  });

  it.each([
    ["run", "LRN-11"],
    ["sessions", "LRN-11"],
    ["show", "LRN-11"],
    ["resume", "LRN-29"],
    ["config", "LRN-04"],
  ])("refuses the planned command %s by naming %s", (command, milestone) => {
    const result = runCli([command], SUPPORTED);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(milestone);
  });
});
