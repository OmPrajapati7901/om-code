/**
 * AC-16.6, unit half: `runTool` orders plan → record → execute, and a
 * `plan()` rejection means `execute()` (and the record) never happen.
 */

import type { ToolCall } from "@om-code/protocol";
import { expect, it } from "vitest";
import { runTool, type Tool, type ToolContext, type ToolIo } from "../src/index.js";
import { fakeCapability, fakeDescriptor, fakeEnd } from "./fixtures.js";

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

function context(): ToolContext {
  return {
    cwd: "/test",
    envAllowlist: [],
    budget: { maxBytes: 1024, maxMs: 1000 },
    signal: new AbortController().signal,
  };
}

async function drain(events: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of events) {
    // Consume fully; ordering is what matters.
  }
}

it("orders plan, then record, then execute", async () => {
  const order: string[] = [];
  const tool: Tool = {
    descriptor: () => fakeDescriptor("read"),
    plan: async () => {
      order.push("plan");
      return fakeCapability();
    },
    execute: (_input, _io, _ctx) => {
      order.push("execute");
      return fakeEnd();
    },
  };
  const recorded: ToolCall[] = [];
  await drain(
    runTool(tool, { path: "a" }, unusedIo(), context(), {
      callId: "c1",
      record: async (call) => {
        order.push("record");
        recorded.push(call);
      },
    }),
  );
  expect(order).toEqual(["plan", "record", "execute"]);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({
    kind: "tool_call",
    call_id: "c1",
    tool: "read",
    input: { path: "a" },
    capability: { risk_class: "read" },
  });
});

it("never records or executes when plan() rejects", async () => {
  const tool: Tool = {
    descriptor: () => fakeDescriptor("read"),
    plan: async () => {
      throw new Error("cannot plan this input");
    },
    execute: () => {
      throw new Error("execute must not run");
    },
  };
  let recorded = 0;
  await expect(
    drain(
      runTool(tool, { path: "a" }, unusedIo(), context(), {
        callId: "c1",
        record: async () => {
          recorded += 1;
        },
      }),
    ),
  ).rejects.toThrow("cannot plan this input");
  expect(recorded).toBe(0);
});
