/**
 * Stub typed failures (LRN-12, AC-12.4; DoD-2's failure path).
 *
 * `write`, `shell` and `batch` are present in the type from now on but throw
 * `NotImplemented` until M3 — naming the milestone that delivers them.
 */

import { describe, expect, it } from "vitest";
import { isStubError, notImplemented, StubError } from "../src/index.js";

describe("stub not-implemented (AC-12.4)", () => {
  it.each([
    ["write", "M3 (LRN-26)"],
    ["shell", "M3 (LRN-27)"],
    ["batch", "M3"],
  ] as const)("notImplemented(%s) throws naming %s", (method, milestone) => {
    try {
      notImplemented(method);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StubError);
      expect(isStubError(error)).toBe(true);
      if (isStubError(error)) {
        expect(error.kind).toBe("not-implemented");
        expect(error.message).toContain(`"${method}"`);
        expect(error.message).toContain(milestone);
        expect(error.details).toMatchObject({ method });
      }
    }
  });

  it("isStubError recognises StubError and rejects a plain Error (DoD-2)", () => {
    expect(isStubError(new StubError("io", "disk gone"))).toBe(true);
    expect(isStubError(new Error("disk gone"))).toBe(false);
    expect(isStubError(null)).toBe(false);
    expect(isStubError({ kind: "io" })).toBe(false);
  });
});
