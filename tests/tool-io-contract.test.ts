/**
 * The drift pin for the structural port (LRN-16): `StubClient` — and
 * `createLocalDriver`'s return — must stay assignable to `ToolIo` without a
 * translation layer. The assignment below fails compilation the moment the
 * two shapes diverge; the runtime half proves the seven methods exist on a
 * real driver.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDriver } from "@om-code/stub-client";
import type { ToolIo } from "@om-code/tools";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("StubClient satisfies ToolIo with no adapter", () => {
  const dir = mkdtempSync(join(tmpdir(), "om-io-"));
  roots.push(dir);
  // Compile-time: a StubClient must satisfy ToolIo or this line breaks.
  const io: ToolIo = createLocalDriver({ root: dir });
  // Runtime: the seven tool-facing methods exist on a real driver.
  for (const method of ["read", "write", "stat", "glob", "grep", "exec", "shell"] as const) {
    expect(typeof io[method]).toBe("function");
  }
});
