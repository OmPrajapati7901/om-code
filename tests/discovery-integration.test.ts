/**
 * LRN-20/AC-20.3: `.gitignore` rules reach the search tools end to end.
 *
 * The driver delegates to `rg` (ignore-aware by construction, AC-13.5), so
 * this pins the product-level behavior on a fixture repo rather than
 * re-proving the mechanism the driver contract suite already covers.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDriver } from "@om-code/stub-client";
import {
  createGlobTool,
  createGrepTool,
  runTool,
  type Tool,
  type ToolContext,
  type ToolEvent,
} from "@om-code/tools";
import { afterEach, beforeEach, expect, it } from "vitest";

let base = "";
let root = "";

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "om-discovery-it-"));
  root = join(base, "workspace");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "ignored"));
  writeFileSync(join(root, ".gitignore"), "ignored/\n");
  writeFileSync(join(root, "visible.txt"), "shared marker line\n");
  writeFileSync(join(root, "ignored", "secret.txt"), "shared marker line\n");
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

it("AC-20.3 grep skips gitignored files", async () => {
  const text = preview(await execute(createGrepTool(), { pattern: "shared marker" }));
  expect(text).toContain("visible.txt");
  expect(text).not.toContain("secret.txt");
});

it("AC-20.3 glob skips gitignored files", async () => {
  const text = preview(await execute(createGlobTool(), { pattern: "**/*.txt" }));
  expect(text).toContain("visible.txt");
  expect(text).not.toContain("secret.txt");
});
