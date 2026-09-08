/**
 * LRN-18 A5 failure table: every failure returns a failed outcome, never throws.
 * LRN-19: truncation wraps every outcome; notrunc is operator-only (AC-19.7).
 */
import type { Bounder } from "@om-code/context";
import { createBounder } from "@om-code/context";
import type { TierRules } from "@om-code/policy";
import type { CompleteToolCall, Permission, ToolCall } from "@om-code/protocol";
import { createRegistry, type Tool, type ToolIo } from "@om-code/tools";
import { describe, expect, it } from "vitest";
import { createToolRunner } from "../src/tool-runner.js";

function unusedIo(): ToolIo {
  const unused = (): never => {
    throw new Error("unused io");
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

function callFor(name: string, argsRaw: string, callId = "c1"): CompleteToolCall {
  return { index: 0, call_id: callId, name, arguments_raw: argsRaw };
}

function passthroughBounder(): Bounder {
  return { bound: async (outcome) => ({ ...outcome }) };
}

function depsFor(
  registry: ReturnType<typeof createRegistry>,
  overrides: Partial<{ bounder: Bounder; notrunc: boolean; policyTiers: TierRules[] }> = {},
) {
  const recorded: ToolCall[] = [];
  const permissions: Permission[] = [];
  const runner = createToolRunner({
    registry,
    io: unusedIo(),
    cwd: "/repo",
    envAllowlist: [],
    budget: { maxBytes: 4096, maxMs: 5000 },
    bounder: overrides.bounder ?? passthroughBounder(),
    ...(overrides.notrunc === undefined ? {} : { notrunc: overrides.notrunc }),
    policyTiers: overrides.policyTiers ?? [],
  });
  return { runner, recorded, permissions };
}

function runWith(
  runner: ReturnType<typeof createToolRunner>,
  recorded: ToolCall[],
  permissions: Permission[],
  name = "read",
  argsRaw = "{}",
) {
  return runner.run(callFor(name, argsRaw), {
    record: async (entry) => {
      recorded.push(entry);
    },
    signal: new AbortController().signal,
    recordPermission: async (entry) => {
      permissions.push(entry);
    },
  });
}

function fakeTool(overrides: Partial<Tool> & { name?: "read" | "grep" | "glob" }): Tool {
  const name = overrides.name ?? "read";
  return {
    descriptor: () => ({
      name,
      version: "0.1.0",
      description: "fake",
      risk_class: "read",
      parameters: {},
    }),
    plan: async () => ({ risk_class: "read" }),
    execute: async function* () {
      yield {
        type: "end",
        result: { status: "ok", preview: "fine", bytes: 4, truncated: false },
      };
    },
    ...overrides,
  } as Tool;
}

describe("createToolRunner (LRN-18 A5)", () => {
  it("returns an error naming the unknown tool without journaling a tool_call", async () => {
    const { runner, recorded } = depsFor(createRegistry([fakeTool({})]));
    const outcome = await runner.run(callFor("grep", "{}"), {
      record: async (entry) => {
        recorded.push(entry);
      },
      signal: new AbortController().signal,
    });
    expect(outcome).toMatchObject({ status: "error" });
    expect(outcome.preview).toMatch(/unknown tool "grep"/);
    expect(recorded).toHaveLength(0);
  });

  it("returns a parse error echoing the raw arguments without journaling", async () => {
    const { runner, recorded } = depsFor(createRegistry([fakeTool({})]));
    const outcome = await runner.run(callFor("read", "{not json"), {
      record: async (entry) => {
        recorded.push(entry);
      },
      signal: new AbortController().signal,
    });
    expect(outcome.status).toBe("error");
    expect(outcome.preview).toMatch(/invalid JSON/);
    expect(outcome.preview).toContain("{not json");
    expect(recorded).toHaveLength(0);
  });

  it("returns an error without a tool_call when plan() rejects", async () => {
    const rejecting = fakeTool({
      plan: async () => {
        throw new Error("no capability");
      },
    });
    const { runner, recorded } = depsFor(createRegistry([rejecting]));
    const outcome = await runner.run(callFor("read", "{}"), {
      record: async (entry) => {
        recorded.push(entry);
      },
      signal: new AbortController().signal,
    });
    expect(outcome.status).toBe("error");
    expect(outcome.preview).toMatch(/no capability/);
    expect(recorded).toHaveLength(0);
  });

  it("returns an error without a tool_call when input fails validation", async () => {
    // Real read tool: missing `path` fails its Zod schema as invalid-input.
    const { readOnlyTools } = await import("@om-code/tools");
    const { runner, recorded } = depsFor(createRegistry(readOnlyTools()));
    const outcome = await runner.run(callFor("read", "{}"), {
      record: async (entry) => {
        recorded.push(entry);
      },
      signal: new AbortController().signal,
    });
    expect(outcome.status).toBe("error");
    expect(recorded).toHaveLength(0);
  });

  it("journals the tool_call before surfacing an execute() throw", async () => {
    const throwing = fakeTool({
      execute: async function* () {
        yield { type: "output", text: "partial" };
        throw new Error("stub exploded");
      },
    });
    const { runner, recorded } = depsFor(createRegistry([throwing]));
    const outcome = await runner.run(callFor("read", "{}"), {
      record: async (entry) => {
        recorded.push(entry);
      },
      signal: new AbortController().signal,
    });
    expect(outcome).toMatchObject({ status: "error" });
    expect(outcome.preview).toContain("stub exploded");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ kind: "tool_call", call_id: "c1" });
  });

  it("reports a protocol violation when the generator ends without an end event", async () => {
    const noEnd = fakeTool({
      execute: async function* () {
        yield { type: "output", text: "only output" };
      },
    });
    const { runner } = depsFor(createRegistry([noEnd]));
    const outcome = await runner.run(callFor("read", "{}"), {
      record: async () => {},
      signal: new AbortController().signal,
    });
    expect(outcome.status).toBe("error");
    expect(outcome.preview).toMatch(/without an end event/);
  });

  it("returns the end event's result verbatim and discards output events", async () => {
    const expected = {
      status: "ok" as const,
      preview: "the preview",
      bytes: 11,
      truncated: true,
    };
    const verbatim = fakeTool({
      execute: async function* () {
        yield { type: "output", text: "the preview" };
        yield { type: "end", result: expected };
      },
    });
    const { runner, recorded } = depsFor(createRegistry([verbatim]));
    const outcome = await runner.run(callFor("read", "{}"), {
      record: async (entry) => {
        recorded.push(entry);
      },
      signal: new AbortController().signal,
    });
    expect(outcome).toEqual(expected);
    expect(recorded).toHaveLength(1);
  });

  it("AC-19.7 rejects a model-supplied notrunc as invalid input", async () => {
    // The tools' Zod schemas are strict and know no `notrunc` key, so the
    // marker can only arrive via `om run --notrunc`, never via arguments_raw.
    const { readOnlyTools } = await import("@om-code/tools");
    const { runner, recorded } = depsFor(createRegistry(readOnlyTools()));
    const outcome = await runner.run(callFor("read", '{"path":"x","notrunc":true}'), {
      record: async (entry) => {
        recorded.push(entry);
      },
      signal: new AbortController().signal,
    });
    expect(outcome.status).toBe("error");
    expect(recorded).toHaveLength(0);
  });

  it("AC-19.7 truncates by default but passes through with --notrunc", async () => {
    const puts: Uint8Array[] = [];
    const bounder = createBounder({
      blobs: {
        put: async (bytes: Uint8Array) => {
          puts.push(bytes);
          return `sha256:${"f".repeat(64)}`;
        },
      },
      maxResultBytes: 16,
    });
    const big = fakeTool({
      execute: async function* () {
        yield {
          type: "end",
          result: { status: "ok", preview: "x".repeat(1024), bytes: 1024, truncated: false },
        };
      },
    });
    const record = async () => {};
    const signal = new AbortController().signal;
    const capped = await depsFor(createRegistry([big]), { bounder }).runner.run(
      callFor("read", "{}"),
      { record, signal },
    );
    expect(capped.truncated).toBe(true);
    expect(puts).toHaveLength(1);
    const marked = await depsFor(createRegistry([big]), { bounder, notrunc: true }).runner.run(
      callFor("read", "{}"),
      { record, signal },
    );
    expect(marked.preview).toBe("x".repeat(1024));
    expect(marked.truncated).toBe(false);
  });

  it("AC-21.7 journals the permission before the effect and denies without executing", async () => {
    let executed = false;
    const gated = fakeTool({
      execute: async function* () {
        executed = true;
        yield {
          type: "end",
          result: { status: "ok", preview: "must not run", bytes: 11, truncated: false },
        };
      },
    });
    const { runner, recorded, permissions } = depsFor(createRegistry([gated]), {
      policyTiers: [
        {
          tier: "user",
          rules: [{ id: "u-deny", outcome: "deny", reason: "locked down", match: {} }],
        },
      ],
    });
    const outcome = await runWith(runner, recorded, permissions);
    expect(outcome.status).toBe("denied");
    expect(outcome.preview).toContain("policy denied");
    expect(outcome.preview).toContain("locked down");
    expect(outcome.preview).toContain("LRN-22");
    expect(executed).toBe(false);
    expect(recorded).toHaveLength(1);
    expect(permissions).toEqual([
      {
        kind: "permission",
        schemaVersion: 2,
        call_id: "c1",
        decision: "deny",
        scope: "once",
        decided_by: "rule",
        reason: "[user] locked down",
      },
    ]);
  });

  it("AC-21.7 an ask blocks with an approval pointer and system attribution", async () => {
    const execTool = fakeTool({
      plan: async () => ({ risk_class: "exec" as const }),
    });
    const { runner, recorded, permissions } = depsFor(createRegistry([execTool]));
    const outcome = await runWith(runner, recorded, permissions);
    expect(outcome.status).toBe("denied");
    expect(outcome.preview).toContain("approval required");
    expect(outcome.preview).toContain("LRN-22");
    expect(permissions).toHaveLength(1);
    expect(permissions[0]).toMatchObject({ decision: "ask", decided_by: "system" });
  });

  it("AC-21.7 a failing permission journal aborts the turn instead of converting", async () => {
    const { runner, recorded } = depsFor(createRegistry([fakeTool({})]));
    await expect(
      runner.run(callFor("read", "{}"), {
        record: async (entry) => {
          recorded.push(entry);
        },
        signal: new AbortController().signal,
        recordPermission: async () => {
          throw new Error("journal gone");
        },
      }),
    ).rejects.toThrow("journal gone");
  });
});
