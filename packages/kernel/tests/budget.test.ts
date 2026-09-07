/**
 * LRN-19 kernel budget wiring (AC-19.5, AC-19.6, DoD-1/DoD-2).
 *
 * The loop consults `TurnBudget` through the structural port: `check`
 * before each inference, `recordInference` after it. Limit trips terminate
 * as `limited` (exit 3); `max-cost-unknown-usage` fails (exit 1).
 */
import type {
  CompleteToolCall,
  Entry,
  JournalRecord,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  Usage,
} from "@om-code/protocol";
import { expect, it } from "vitest";
import type { TurnBudget } from "../src/index.js";
import {
  type BudgetTrip,
  type JournalSink,
  runTurn,
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

function textResponse(text: string, usage: Usage = { kind: "unknown" }): ModelResponse {
  return {
    content: [{ type: "text", text }],
    tool_calls: [],
    usage,
    outcome: { kind: "complete" },
  };
}

class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  private readonly responses: readonly ModelResponse[];
  constructor(responses: readonly ModelResponse[]) {
    this.responses = responses;
  }

  async *stream(request: ModelRequest, _signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.requests.push(request);
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
  budget: TurnBudget | undefined,
  overrides: Partial<TurnInput> = {},
): TurnInput {
  return {
    session: readySession(),
    text: "go",
    provider,
    journal,
    newTurnId: () => "turn-1",
    signal: new AbortController().signal,
    model: "fixture",
    environment: FIXED_ENVIRONMENT,
    instructions: [],
    tools: [],
    ...(budget === undefined ? {} : { budget }),
    ...overrides,
  };
}

async function collect(iterable: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function stubBudget(trip: BudgetTrip | undefined, on: "check" | "record"): TurnBudget {
  return {
    check: () => (on === "check" ? trip : undefined),
    recordInference: () => (on === "record" ? trip : undefined),
  };
}

it("a pre-inference trip journals error + turn_end as limited without inferring", async () => {
  const journal = new MemoryJournal();
  const provider = new ScriptedProvider([textResponse("never")]);
  const events = await collect(
    runTurn(
      input(provider, journal, stubBudget({ reason: "max-turns", message: "capped" }, "check")),
    ),
  );

  expect(provider.requests).toHaveLength(0);
  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual([
    "user_message",
    "error",
    "turn_end",
  ]);
  expect(journal.appends[1]?.entry).toMatchObject({
    source: "local",
    reason: "max-turns",
    retryable: false,
  });
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "limited" } });
});

it("a post-inference trip keeps the assistant journaled, then limits with one turn_end", async () => {
  const journal = new MemoryJournal();
  const provider = new ScriptedProvider([textResponse("spent")]);
  const events = await collect(
    runTurn(
      input(provider, journal, stubBudget({ reason: "max-cost", message: "over" }, "record")),
    ),
  );

  expect(provider.requests).toHaveLength(1);
  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual([
    "user_message",
    "prompt",
    "assistant_message",
    "error",
    "turn_end",
  ]);
  expect(journal.appends.filter(({ entry }) => entry.kind === "turn_end")).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "limited" } });
});

it("max-cost-unknown-usage fails the turn (exit 1) instead of limiting", async () => {
  const journal = new MemoryJournal();
  const provider = new ScriptedProvider([textResponse("mystery")]);
  const events = await collect(
    runTurn(
      input(
        provider,
        journal,
        stubBudget({ reason: "max-cost-unknown-usage", message: "no usage" }, "record"),
      ),
    ),
  );

  expect(journal.appends.at(-2)?.entry).toMatchObject({
    source: "local",
    reason: "max-cost-unknown-usage",
  });
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "failed" } });
});

it("a trip on the second iteration stops the loop after one inference", async () => {
  const journal = new MemoryJournal();
  const calls: CompleteToolCall[] = [
    { index: 0, call_id: "c1", name: "read", arguments_raw: "{}" },
  ];
  const provider = new ScriptedProvider([
    {
      content: [{ type: "text", text: "working" }],
      tool_calls: calls,
      usage: { kind: "unknown" },
      outcome: { kind: "complete" },
    },
    textResponse("never"),
  ]);
  let inferences = 0;
  const budget: TurnBudget = {
    check: () => (inferences >= 1 ? { reason: "max-turns", message: "capped" } : undefined),
    recordInference: () => {
      inferences += 1;
      return undefined;
    },
  };
  const events = await collect(
    runTurn(
      input(provider, journal, budget, {
        tools: [{ name: "read", description: "read", parameters: {} }],
        toolRunner: {
          run: async (call, deps) => {
            await deps.record({
              kind: "tool_call",
              schemaVersion: 1,
              call_id: call.call_id,
              tool: call.name,
              input: {},
              capability: { risk_class: "read" },
            });
            return { status: "ok", preview: "ok", bytes: 2, truncated: false };
          },
        },
      }),
    ),
  );

  expect(provider.requests).toHaveLength(1);
  expect(journal.appends.filter(({ entry }) => entry.kind === "turn_end")).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "limited" } });
});

it("an absent budget leaves the single-shot path unbounded", async () => {
  const journal = new MemoryJournal();
  const provider = new ScriptedProvider([textResponse("free")]);
  const events = await collect(runTurn(input(provider, journal, undefined)));
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "completed" } });
});
