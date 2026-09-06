/**
 * AC-4.4 — malformed config files produce a message naming the file, the
 * field and the expected shape, never a stack trace (LRN-04).
 *
 * (a) and (b) are caught at read time by the tier-file schema. (c) — a
 * syntactically well-formed string that is not a credential reference — passes
 * the loose file schema and is rejected at resolve time with the tier file as
 * its origin, so the message still names the file, the field and the shape.
 */

import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/config/errors.js";
import { parseTierDocument, readTierFile } from "../src/config/read.js";
import { resolveSettings } from "../src/config/resolve.js";

const PATH = "/tmp/om-home/config.json";

function assertNoStack(error: unknown): void {
  expect(error).toBeInstanceOf(ConfigError);
  const message = (error as ConfigError).message;
  expect(message).not.toContain("\n    at ");
  expect((error as ConfigError).stack).toBeDefined();
  expect(message).not.toContain("node_modules/zod");
}

describe("AC-4.4a — syntactically invalid JSON", () => {
  it("names the file and the line/column", () => {
    let caught: unknown;
    try {
      parseTierDocument(PATH, '{"baseUrl": ');
    } catch (error) {
      caught = error;
    }
    assertNoStack(caught);
    const message = (caught as ConfigError).message;
    expect(message).toContain(PATH);
    expect(message).toMatch(/1:\d+/);
    expect((caught as ConfigError).kind).toBe("invalid-json");
  });
});

describe("AC-4.4b — baseUrl as a number", () => {
  it("names the file, the field and the expected shape", () => {
    let caught: unknown;
    try {
      parseTierDocument(PATH, '{"baseUrl": 42}');
    } catch (error) {
      caught = error;
    }
    assertNoStack(caught);
    const message = (caught as ConfigError).message;
    expect(message).toContain(PATH);
    expect(message).toContain("baseUrl");
    expect(message).toContain("string");
  });

  it("rejects unknown keys rather than silently ignoring typos", () => {
    let caught: unknown;
    try {
      parseTierDocument(PATH, '{"baseURL": "https://x.example.com"}');
    } catch (error) {
      caught = error;
    }
    assertNoStack(caught);
    expect((caught as ConfigError).message).toContain(PATH);
  });
});

describe("AC-4.4c — an unparseable credential reference", () => {
  it("names the file, the field and the expected shape", () => {
    let caught: unknown;
    try {
      resolveSettings({
        user: { credential: "bogus-without-scheme" },
        project: undefined,
        userPath: PATH,
        projectPath: "/repo/.om-code/settings.json",
        env: {},
        flags: {},
        resolveSecret: () => undefined,
      });
    } catch (error) {
      caught = error;
    }
    assertNoStack(caught);
    const message = (caught as ConfigError).message;
    expect(message).toContain(PATH);
    expect(message).toContain("credential");
    expect(message).toContain("env:<VAR>");
  });
});

describe("absent and unreadable tiers", () => {
  it("a missing file is an absent tier, not an error", () => {
    const result = readTierFile(PATH, () => {
      const error = new Error("no such file") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    });
    expect(result).toBeUndefined();
  });

  it("an unreadable file names the file", () => {
    let caught: unknown;
    try {
      readTierFile(PATH, () => {
        const error = new Error("permission denied") as Error & { code: string };
        error.code = "EACCES";
        throw error;
      });
    } catch (error) {
      caught = error;
    }
    assertNoStack(caught);
    expect((caught as ConfigError).message).toContain(PATH);
    expect((caught as ConfigError).kind).toBe("unreadable-file");
  });
});
