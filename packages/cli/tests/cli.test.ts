import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { type CliDeps, runCli } from "../src/cli.js";
import type { HostPlatform } from "../src/platform.js";
import { readVersion } from "../src/version.js";

const requireFromHere = createRequire(import.meta.url);
const manifest = requireFromHere("../package.json") as { version: string };

const SUPPORTED: HostPlatform = { platform: "darwin", arch: "arm64" };
const UNSUPPORTED: HostPlatform = { platform: "linux", arch: "x64" };

function testDeps(host: HostPlatform): CliDeps {
  const stream = new PassThrough();
  return {
    host,
    env: {},
    cwd: "/tmp/om-test",
    loadSettings: () => {
      throw new Error("loadSettings must not be called in this test");
    },
    io: {
      write: () => {},
      writeErr: () => {},
      input: stream,
      output: stream,
      isTty: false,
    },
    now: () => new Date("2026-09-06T00:00:00Z"),
    newId: () => "00000000-0000-7000-8000-000000000000",
    createProvider: () => {
      throw new Error("createProvider must not be called in this test");
    },
    osLabel: `${host.platform}/${host.arch}`,
  };
}

describe("AC-3.3 — om --version", () => {
  it("prints the version declared in package.json", async () => {
    const result = await runCli(["--version"], testDeps(SUPPORTED));
    expect(result.stdout).toBe(`${manifest.version}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("resolves that version through readVersion, so there is one source", () => {
    expect(readVersion()).toBe(manifest.version);
  });

  it("accepts the -v alias", async () => {
    expect((await runCli(["-v"], testDeps(SUPPORTED))).stdout).toBe(`${manifest.version}\n`);
  });
});

describe("AC-3.4 — the guard runs before any command", () => {
  it("refuses --version on an unsupported host with exit 1", async () => {
    const result = await runCli(["--version"], testDeps(UNSUPPORTED));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("linux/x64");
  });

  it("refuses --help on an unsupported host too — nothing proceeds silently", async () => {
    const result = await runCli(["--help"], testDeps(UNSUPPORTED));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("refuses an unsupported host with no arguments at all", async () => {
    const result = await runCli([], testDeps(UNSUPPORTED));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unsupported host");
  });

  it("refuses config print on an unsupported host before loading settings", async () => {
    const result = await runCli(["config", "print"], testDeps(UNSUPPORTED));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unsupported host");
  });
});

describe("help and argument errors", () => {
  it("prints help with no arguments and exits 0", async () => {
    const result = await runCli([], testDeps(SUPPORTED));
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("om run");
    expect(result.exitCode).toBe(0);
  });

  it("prints help for --help and -h", async () => {
    expect((await runCli(["--help"], testDeps(SUPPORTED))).stdout).toContain("Usage:");
    expect((await runCli(["-h"], testDeps(SUPPORTED))).stdout).toContain("Usage:");
  });

  it("exits 1 on an unknown argument and says so on stderr", async () => {
    const result = await runCli(["--nope"], testDeps(SUPPORTED));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('unknown argument "--nope"');
  });

  it("refuses only the still-planned resume command", async () => {
    const result = await runCli(["resume"], testDeps(SUPPORTED));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("LRN-29");
  });

  it("dispatches config print instead of refusing it as planned", async () => {
    const result = await runCli(["config"], testDeps(SUPPORTED));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("subcommand");
    expect(result.stderr).not.toContain("LRN-04");
  });
});
