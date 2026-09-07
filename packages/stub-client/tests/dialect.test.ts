/**
 * Dialect contract enforcement (LRN-12, AC-12.6; X-14, ADR-025).
 *
 * The regex dialect, the glob dialect and the path-canonicalization semantics
 * are pinned here so LRN-13's contract suite cannot accidentally depend on
 * JS `RegExp`, picomatch/tinyglobby, or Node `realpath` behaviour that Rust's
 * `regex`, `globset` and `canonicalize` would not reproduce in M4.
 */

import { describe, expect, it } from "vitest";
import {
  assertSupportedGlob,
  assertSupportedRegex,
  isInsideRoot,
  isStubError,
} from "../src/index.js";

function expectUnsupported(fn: () => void): void {
  try {
    fn();
    expect.unreachable("expected an unsupported-pattern StubError");
  } catch (error) {
    expect(isStubError(error)).toBe(true);
    if (isStubError(error)) expect(error.kind).toBe("unsupported-pattern");
  }
}

describe("regex dialect (AC-12.6)", () => {
  it("refuses lookahead rather than silently accepting it", () => {
    expectUnsupported(() => assertSupportedRegex("foo(?=bar)"));
    expectUnsupported(() => assertSupportedRegex("foo(?!bar)"));
  });

  it("refuses lookbehind and backreferences", () => {
    expectUnsupported(() => assertSupportedRegex("foo(?<=bar)"));
    expectUnsupported(() => assertSupportedRegex("foo(?<!bar)"));
    expectUnsupported(() => assertSupportedRegex("(a)\\1"));
    expectUnsupported(() => assertSupportedRegex("\\k<n>"));
  });

  it("accepts the intersection subset without false positives", () => {
    expect(() => assertSupportedRegex("\\(?=")).not.toThrow();
    expect(() => assertSupportedRegex("[(?=]")).not.toThrow();
    expect(() => assertSupportedRegex("(?:a|b)")).not.toThrow();
    expect(() => assertSupportedRegex("a{2,3}")).not.toThrow();
    expect(() => assertSupportedRegex("(?i)foo")).not.toThrow();
    expect(() => assertSupportedRegex("\\p{L}")).not.toThrow();
  });
});

describe("glob dialect (AC-12.6)", () => {
  it("accepts the globset intersection subset", () => {
    expect(() => assertSupportedGlob("src/**/*.ts")).not.toThrow();
    expect(() => assertSupportedGlob("{a,b}/*.rs")).not.toThrow();
    expect(() => assertSupportedGlob("[!x]y")).not.toThrow();
  });

  it("refuses extglob and leading-! negation as unsupported-pattern", () => {
    expectUnsupported(() => assertSupportedGlob("src/!(*.test).ts"));
    expectUnsupported(() => assertSupportedGlob("+(a|b)"));
    expectUnsupported(() => assertSupportedGlob("!ignored"));
  });
});

describe("path canonicalization (AC-12.6)", () => {
  it("treats the root itself and a child as inside", () => {
    expect(isInsideRoot("/repo/proj", "/repo/proj")).toBe(true);
    expect(isInsideRoot("/repo/proj", "/repo/proj/src/a.ts")).toBe(true);
  });

  it("rejects sibling-prefix and parent escapes segment-wise", () => {
    expect(isInsideRoot("/repo/proj", "/repo/proj-evil/x")).toBe(false);
    expect(isInsideRoot("/repo/proj", "/repo/pro")).toBe(false);
    expect(isInsideRoot("/repo/proj", "/repo/other")).toBe(false);
    expect(isInsideRoot("/repo/proj", "/etc/passwd")).toBe(false);
  });

  it("does NOT case-fold or normalize: variants are not inside", () => {
    // Both inputs are already OS-canonicalized; folding again here would fork
    // Node and Rust equality (X-14). The canonicalizer collapses variants to
    // the stored spelling before this runs.
    expect(isInsideRoot("/repo/Proj", "/repo/Proj/file")).toBe(true);
    expect(isInsideRoot("/repo/Proj", "/repo/proj/file")).toBe(false);
    const nfcRoot = "/repo/caf\u00E9";
    const nfc = nfcRoot + "/file";
    const nfd = "/repo/cafe\u0301/file";
    expect(nfc).not.toBe(nfd);
    expect(isInsideRoot(nfcRoot, nfc)).toBe(true);
    expect(isInsideRoot(nfcRoot, nfd)).toBe(false);
  });
});
