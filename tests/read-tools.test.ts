/** LRN-17 read tools through runTool and the real local-ts driver. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDriver, isStubError } from "@om-code/stub-client";
import {
  createGlobTool,
  createGrepTool,
  createReadTool,
  READ_REFUSAL_PREFIX,
  runTool,
  type Tool,
  type ToolContext,
  type ToolEvent,
} from "@om-code/tools";
import { afterEach, beforeEach, expect, it } from "vitest";

let base = "";
let root = "";

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "om-read-tools-"));
  root = join(base, "workspace");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "main.ts"), "alpha\nconst needle = true;\nomega\n");
  writeFileSync(join(base, "outside.txt"), "outside\n");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function context(): ToolContext {
  return {
    cwd: root,
    envAllowlist: [],
    budget: { maxBytes: 1_000_000, maxMs: 10_000 },
    signal: new AbortController().signal,
  };
}

async function execute(tool: Tool, input: unknown): Promise<ToolEvent[]> {
  const events: ToolEvent[] = [];
  for await (const event of runTool(tool, input, createLocalDriver({ root }), context(), {
    callId: `call-${tool.descriptor().name}`,
    record: () => Promise.resolve(),
  })) {
    events.push(event);
  }
  return events;
}

function preview(events: readonly ToolEvent[]): string {
  const end = events.find((event) => event.type === "end");
  if (end?.type !== "end") throw new Error("missing tool end event");
  return end.result.preview;
}

it("glob, grep and read explore a real workspace through runTool", async () => {
  expect(preview(await execute(createGlobTool(), { pattern: "**/*.ts" }))).toBe(
    'glob "**/*.ts" in . — 1 file\nsrc/main.ts',
  );
  expect(preview(await execute(createGrepTool(), { pattern: "needle" }))).toBe(
    'grep "needle" in . — 1 match in 1 file\nsrc/main.ts:2:const needle = true;',
  );
  expect(
    preview(await execute(createReadTool(), { path: "src/main.ts", startLine: 2, endLine: 2 })),
  ).toBe("src/main.ts (lines 2-2 of 3)\n     2→const needle = true;");
});

it("reports the full 300-line total through a narrow real-driver read", async () => {
  writeFileSync(
    join(root, "long.txt"),
    Array.from({ length: 300 }, (_, index) => `line ${index + 1}`).join("\n"),
  );
  const text = preview(
    await execute(createReadTool(), { path: "long.txt", startLine: 100, endLine: 110 }),
  );
  expect(text).toContain("long.txt (lines 100-110 of 300)");
  expect(text).toContain("   100→line 100");
  expect(text).toContain("   110→line 110");
});

it("surfaces a genuine path-escape StubError unchanged", async () => {
  let caught: unknown;
  try {
    await execute(createReadTool(), { path: "../outside.txt" });
  } catch (error) {
    caught = error;
  }
  expect(isStubError(caught)).toBe(true);
  if (isStubError(caught)) expect(caught.kind).toBe("path-escape");
});

it("refuses a real file containing a NUL byte", async () => {
  writeFileSync(join(root, "binary.dat"), new Uint8Array([0x61, 0x00, 0x62]));
  const events = await execute(createReadTool(), { path: "binary.dat" });
  const end = events.find((event) => event.type === "end");
  expect(end).toMatchObject({ type: "end", result: { status: "error", bytes: 3 } });
  if (end?.type === "end") expect(end.result.preview).toContain(READ_REFUSAL_PREFIX);
});
