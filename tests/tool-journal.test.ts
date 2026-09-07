/**
 * AC-16.6, integration half: `runTool` with its recorder wired to a real
 * `JournalWriter`. The journal must show each `tool_call` (which carries the
 * `plan()` result as `capability`) at a lower seq than every record the
 * tool's `execute()` durably emitted — ordering in the journal, as the AC
 * words it. Mirrors the `tests/journal-integration.test.ts` pattern.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JournalReader, JournalWriter } from "@om-code/storage";
import { runTool, type Tool, type ToolContext, type ToolEvent, type ToolIo } from "@om-code/tools";
import { afterEach, expect, it } from "vitest";

const trees: string[] = [];
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

function context(): ToolContext {
  return {
    cwd: "/test",
    envAllowlist: [],
    budget: { maxBytes: 4096, maxMs: 5000 },
    signal: new AbortController().signal,
  };
}

function unusedIo(): ToolIo {
  const unused = (): never => {
    throw new Error("unused");
  };
  return {
    read: (_params, _signal) => unused(),
    write: (_params, _signal) => unused(),
    stat: (_params, _signal) => unused(),
    glob: (_params, _signal) => unused(),
    grep: (_params, _signal) => unused(),
    exec: (_params, _signal) => unused(),
    shell: (_params, _signal) => unused(),
  };
}

const SESSION_ID = "0193b4c8-0000-7000-8000-000000000016";

it("tool_call precedes execute's durable effects in the journal", async () => {
  const tree = mkdtempSync(join(tmpdir(), "om-tool-journal-"));
  trees.push(tree);
  const projectRoot = join(tree, "project");
  mkdirSync(join(projectRoot, ".git"), { recursive: true });
  const location = { omHome: join(tree, "home"), projectRoot };
  const writer = await JournalWriter.open({ ...location, sessionId: SESSION_ID });

  // The fake tool durably emits a tool_result through the same writer its
  // caller passed as the recorder — standing in for whatever LRN-18's loop
  // will journal for a real execution.
  const order: string[] = [];
  const tool: Tool = {
    descriptor: () => ({
      name: "read",
      version: "0.1.0",
      description: "journaling fake",
      risk_class: "read",
      parameters: {},
    }),
    plan: async () => {
      order.push("plan");
      return { filesystem: { read: ["notes.md"], write: [] }, risk_class: "read" };
    },
    execute: async function* (): AsyncGenerator<ToolEvent> {
      order.push("execute-start");
      await writer.append(
        {
          kind: "tool_result",
          schemaVersion: 1,
          call_id: "c1",
          preview: "hello",
          bytes: 5,
          truncated: false,
          status: "ok",
        },
        { by: "tool:read" },
      );
      order.push("execute-effect");
      yield {
        type: "end",
        result: { status: "ok", preview: "hello", bytes: 5, truncated: false },
      };
    },
  };

  const seen: ToolEvent[] = [];
  for await (const event of runTool(tool, { path: "notes.md" }, unusedIo(), context(), {
    callId: "c1",
    record: async (call) => {
      await writer.append(call, { by: "model" });
    },
  })) {
    seen.push(event);
  }
  expect(order).toEqual(["plan", "execute-start", "execute-effect"]);
  expect(seen.at(-1)?.type).toBe("end");
  await writer.close();

  const records = (await new JournalReader(location).readAll(SESSION_ID)).records;
  const calls = records.filter((record) => record.entry.kind === "tool_call");
  const results = records.filter((record) => record.entry.kind === "tool_result");
  expect(calls).toHaveLength(1);
  expect(results).toHaveLength(1);
  expect(calls[0]?.entry).toMatchObject({
    call_id: "c1",
    tool: "read",
    capability: { filesystem: { read: ["notes.md"], write: [] }, risk_class: "read" },
  });
  // The plan result (in tool_call.capability) was journaled before the
  // execute-phase effect (tool_result): ordering in the journal.
  expect(calls[0]?.seq).toBeLessThan(results[0]?.seq ?? 0);
});
