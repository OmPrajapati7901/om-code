/** AC-8.5: the suite-level guard blocks sockets and fails a swallowed attempt too. */
import { execFileSync } from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkNoViolations, violationsSoFar } from "./guards/no-network.mjs";

const guardUrl = fileURLToPath(new URL("./guards/no-network.mjs", import.meta.url));

describe("no-network guard: direct calls are blocked", () => {
  // Each test below deliberately triggers exactly the violation it asserts;
  // acknowledge and clear it here so the shared guard's own afterEach (which
  // fails a file on ANY recorded violation, per AC-8.5) does not double-fail
  // these intentional, already-asserted throws.
  afterEach(() => {
    try {
      checkNoViolations();
    } catch {
      /* expected */
    }
  });

  it("blocks fetch", () => {
    expect(() => globalThis.fetch("https://example.invalid/")).toThrow(/network access blocked/);
  });
  it("blocks net.connect and net.createConnection", () => {
    expect(() => net.connect(80, "example.invalid")).toThrow(/network access blocked/);
    expect(() => net.createConnection(80, "example.invalid")).toThrow(/network access blocked/);
  });
  it("blocks tls.connect", () => {
    expect(() => tls.connect(443, "example.invalid")).toThrow(/network access blocked/);
  });
  it("blocks dns.lookup", () => {
    expect(() => dns.lookup("example.invalid", () => {})).toThrow(/network access blocked/);
  });
});

describe("no-network guard: recording survives a swallowed throw", () => {
  it("records a violation even when the caller catches the throw, and checkNoViolations reports and clears it", () => {
    try {
      globalThis.fetch("https://example.invalid/swallowed");
    } catch {
      // intentionally swallowed, as a real test's try/catch might
    }
    expect(violationsSoFar().length).toBeGreaterThan(0);
    expect(() => checkNoViolations()).toThrow(/AC-8.5/);
    expect(violationsSoFar()).toEqual([]);
  });
});

describe("no-network guard: spawned node children (AC-8.5 failure path)", () => {
  it("a planted violation that swallows the throw still exits non-zero", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--import",
          guardUrl,
          fileURLToPath(new URL("./guards/fixtures/violation-child.mjs", import.meta.url)),
        ],
        { stdio: "pipe" },
      ),
    ).toThrow();
  });
  it("a clean child with no network access exits zero", () => {
    const stdout = execFileSync(
      process.execPath,
      [
        "--import",
        guardUrl,
        fileURLToPath(new URL("./guards/fixtures/clean-child.mjs", import.meta.url)),
      ],
      { encoding: "utf8" },
    );
    expect(stdout.trim()).toBe("clean");
  });
});
