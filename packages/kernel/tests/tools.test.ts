/**
 * LRN-18 multi-tool turn (AC-18.1–18.5, DoD-1/DoD-2).
 *
 * Uses the MemoryJournal / StubProvider doubles from turn.test.ts; the
 * scripted provider replays one ModelResponse per `stream` call, mirroring
 * FakeProvider's multi-turn scripts (fake.ts).
 */
import type {
  CompleteToolCall,
  Entry,
  JournalRecord,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "@om-code/protocol";
import { expect, it } from "vitest";
import {
  type JournalSink,
  runTurn,
  type ToolOutcome,
  type ToolRunner,
  type TurnEvent,
  type TurnInput,
} from "../src/index.js";
import { baseSession, FIXED_ENVIRONMENT } from "./fixtures.js";

class MemoryJournal implements JournalSink {
  readonly appends: Array<{
    entry: Entry;
    context: Parameters<JournalSink["append"]>[1];
  }> = [];

  async append(
    entry: Entry,
    context: Parameters<JournalSink["append"]>[1],
  ): Promise<JournalRecord> {
    this.appends.push({ entry: structuredClone(entry), context: structuredClone(context) });
    return {
      v: 1,
      seq: this.appends.length,
      id: `0193b4c8-0000-7000-8000-${String(this.appends.length).padStart(12, "0")}`,
      ts: "2026-09-06T12:00:00Z",
      by: context.by,
      ...(context.turn_id === undefined ? {} : { turn_id: context.turn_id }),
      entry,
      sha256: "0".repeat(64),
    };
  }
}

function textResponse(text: string): ModelResponse {
  return {
    content: [{ type: "text", text }],
    tool_calls: [],
    usage: { kind: "unknown" },
    outcome: { kind: "complete" },
  };
}

function toolsResponse(calls: CompleteToolCall[]): ModelResponse {
  return {
    content: [{ type: "text", text: "working" }],
    tool_calls: calls,
    usage: { kind: "unknown" },
    outcome: { kind: "complete" },
  };
}

function toolCall(index: number, callId: string, name: string, args = "{}"): CompleteToolCall {
  return { index, call_id: callId, name, arguments_raw: args };
}

/** One scripted ModelResponse per provider.stream call. */
class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  readonly journalSizesAtCall: number[] = [];
  private readonly responses: readonly ModelResponse[];
  private readonly journal: MemoryJournal | undefined;
  constructor(responses: readonly ModelResponse[], journal?: MemoryJournal) {
    this.responses = responses;
    this.journal = journal;
  }

  async *stream(request: ModelRequest, _signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    this.journalSizesAtCall.push(this.journal?.appends.length ?? 0);
    const response = this.responses[this.requests.length - 1];
    if (response === undefined) throw new Error("script exhausted");
    yield { type: "message_start", id: `r${this.requests.length}`, model: request.model };
    yield { type: "message_stop", response };
  }
}

function readySession() {
  const session = baseSession();
  session.meta = {
    id: "session-1",
    project_root: "/repo",
    cwd: "/repo",
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
    status: "idle",
    mode: "manual",
    model: { id: "fixture", base_url: "https://fixture.test" },
    tags: [],
  };
  session.resumable = true;
  return session;
}

function input(
  provider: ModelProvider,
  journal: JournalSink,
  toolRunner: ToolRunner | undefined,
  overrides: Partial<TurnInput> = {},
): TurnInput {
  return {
    session: readySession(),
    text: "where is auth handled?",
    provider,
    journal,
    newTurnId: () => "turn-1",
    signal: new AbortController().signal,
    model: "fixture",
    environment: FIXED_ENVIRONMENT,
    instructions: [],
    tools: [{ name: "read", description: "read", parameters: {} }],
    ...(toolRunner === undefined ? {} : { toolRunner }),
    ...overrides,
  };
}

async function collect(iterable: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function okRunner(outcomes?: Map<string, ToolOutcome>): ToolRunner {
  return {
    run: async (call, deps) => {
      await deps.record({
        kind: "tool_call",
        schemaVersion: 1,
        call_id: call.call_id,
        tool: call.name,
        input: {},
        capability: { risk_class: "read" },
      });
      return (
        outcomes?.get(call.call_id) ?? {
          status: "ok",
          preview: `result for ${call.call_id}`,
          bytes: 10,
          truncated: false,
        }
      );
    },
  };
}

it("AC-18.1 executes all n calls before the next inference", async () => {
  const journal = new MemoryJournal();
  const calls = [toolCall(0, "c1", "read"), toolCall(1, "c2", "read"), toolCall(2, "c3", "read")];
  const provider = new ScriptedProvider([toolsResponse(calls), textResponse("done")], journal);
  const events = await collect(runTurn(input(provider, journal, okRunner())));

  expect(provider.requests).toHaveLength(2);
  // All three outcomes were journaled before the second inference began.
  expect(provider.journalSizesAtCall[1]).toBeGreaterThanOrEqual(1 + 1 + 1 + 3 + 3);
  const kinds = journal.appends.map(({ entry }) => entry.kind);
  expect(kinds).toEqual([
    "user_message",
    "prompt",
    "assistant_message",
    "tool_call",
    "tool_call",
    "tool_call",
    "tool_result",
    "tool_result",
    "tool_result",
    "prompt",
    "assistant_message",
    "turn_end",
  ]);
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "completed" } });
});

it("AC-18.2 runs independent calls concurrently", async () => {
  const journal = new MemoryJournal();
  const calls = [toolCall(0, "c1", "read"), toolCall(1, "c2", "read"), toolCall(2, "c3", "read")];
  const provider = new ScriptedProvider([toolsResponse(calls), textResponse("done")]);
  const sleeping: ToolRunner = {
    run: async (call, deps) => {
      await deps.record({
        kind: "tool_call",
        schemaVersion: 1,
        call_id: call.call_id,
        tool: call.name,
        input: {},
        capability: { risk_class: "read" },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { status: "ok", preview: "ok", bytes: 2, truncated: false };
    },
  };
  const startedAt = Date.now();
  await collect(runTurn(input(provider, journal, sleeping)));
  const elapsed = Date.now() - startedAt;
  expect(elapsed).toBeLessThan(300);
});

it("AC-18.3 correlates tool_call/tool_result by call_id in journal order", async () => {
  const journal = new MemoryJournal();
  const calls = [toolCall(0, "c1", "read"), toolCall(1, "c2", "grep")];
  const provider = new ScriptedProvider([toolsResponse(calls), textResponse("done")]);
  await collect(runTurn(input(provider, journal, okRunner())));

  const seqByKind = new Map<string, number>();
  for (const [index, { entry }] of journal.appends.entries()) {
    if (entry.kind === "tool_call" || entry.kind === "tool_result") {
      seqByKind.set(`${entry.kind}:${entry.call_id}`, index + 1);
    }
  }
  for (const call of calls) {
    const callSeq = seqByKind.get(`tool_call:${call.call_id}`);
    const resultSeq = seqByKind.get(`tool_result:${call.call_id}`);
    expect(callSeq).toBeDefined();
    expect(resultSeq).toBeDefined();
    expect(callSeq).toBeLessThan(resultSeq ?? 0);
  }
  const toolResults = journal.appends.filter(({ entry }) => entry.kind === "tool_result");
  expect(toolResults).toHaveLength(2);
  for (const { context } of toolResults) {
    expect(context.by.startsWith("tool:")).toBe(true);
    expect(context.turn_id).toBe("turn-1");
  }
});

it("AC-18.4 feeds a failed tool result back to the model without aborting", async () => {
  const journal = new MemoryJournal();
  const calls = [toolCall(0, "c1", "read"), toolCall(1, "c2", "read")];
  const provider = new ScriptedProvider([toolsResponse(calls), textResponse("recovered")]);
  const runner: ToolRunner = {
    run: async (call, deps) => {
      await deps.record({
        kind: "tool_call",
        schemaVersion: 1,
        call_id: call.call_id,
        tool: call.name,
        input: {},
        capability: { risk_class: "read" },
      });
      if (call.call_id === "c1")
        return { status: "error", preview: "boom", bytes: 4, truncated: false };
      return { status: "ok", preview: "fine", bytes: 4, truncated: false };
    },
  };
  const events = await collect(runTurn(input(provider, journal, runner)));

  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "completed" } });
  const second = provider.requests[1];
  expect(second).toBeDefined();
  const toolMessages = (second?.messages ?? []).filter((message) => message.role === "tool");
  expect(toolMessages).toHaveLength(2);
  expect(toolMessages.map((message) => (message.role === "tool" ? message.call_id : ""))).toEqual([
    "c1",
    "c2",
  ]);
  expect(toolMessages[0]).toMatchObject({ content: "boom" });
});

it("AC-18.5 terminates with exactly one turn_end when the model answers text", async () => {
  const journal = new MemoryJournal();
  const provider = new ScriptedProvider([
    toolsResponse([toolCall(0, "c1", "read")]),
    textResponse("final"),
  ]);
  await collect(runTurn(input(provider, journal, okRunner())));

  expect(journal.appends.filter(({ entry }) => entry.kind === "turn_end")).toHaveLength(1);
  expect(provider.requests).toHaveLength(2);
});

it("awaits the tool_call append before the effect runs (AC-16.6 ordering)", async () => {
  const journal = new MemoryJournal();
  const append = journal.append.bind(journal);
  let releaseCall!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseCall = resolve;
  });
  let effectRan = false;
  journal.append = async (entry, context) => {
    const record = await append(entry, context);
    if (entry.kind === "tool_call") await gate;
    return record;
  };
  const provider = new ScriptedProvider([
    toolsResponse([toolCall(0, "c1", "read")]),
    textResponse("done"),
  ]);
  const runner: ToolRunner = {
    run: async (call, deps) => {
      await deps.record({
        kind: "tool_call",
        schemaVersion: 1,
        call_id: call.call_id,
        tool: call.name,
        input: {},
        capability: { risk_class: "read" },
      });
      effectRan = true;
      return { status: "ok", preview: "ok", bytes: 2, truncated: false };
    },
  };
  const done = collect(runTurn(input(provider, journal, runner)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(effectRan).toBe(false);
  releaseCall();
  await done;
  expect(effectRan).toBe(true);
});
