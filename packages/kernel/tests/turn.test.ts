import {
  type Entry,
  type JournalRecord,
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  ProviderError,
} from "@om-code/protocol";
import { expect, it } from "vitest";
import { type JournalSink, runTurn, type TurnEvent, type TurnInput } from "../src/index.js";
import { baseSession, FIXED_ENVIRONMENT } from "./fixtures.js";

const COMPLETE_RESPONSE: ModelResponse = {
  content: [
    { type: "thinking", text: "consider" },
    { type: "text", text: "hello world" },
  ],
  tool_calls: [],
  usage: { kind: "known", input_tokens: 4, output_tokens: 2 },
  stop_reason: "stop",
  outcome: { kind: "complete" },
};

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

class StubProvider implements ModelProvider {
  calls = 0;
  readonly requests: ModelRequest[] = [];
  private readonly events: readonly ModelEvent[];
  private readonly failure: ProviderError | undefined;

  constructor(events: readonly ModelEvent[], failure?: ProviderError) {
    this.events = events;
    this.failure = failure;
  }

  stream(request: ModelRequest, _signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.calls++;
    this.requests.push(request);
    const events = this.events;
    const failure = this.failure;
    return (async function* () {
      yield* events;
      if (failure !== undefined) throw failure;
    })();
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
  overrides: Partial<TurnInput> = {},
): TurnInput {
  return {
    session: readySession(),
    text: "say hello",
    provider,
    journal,
    newTurnId: () => "turn-1",
    signal: new AbortController().signal,
    model: "fixture",
    environment: FIXED_ENVIRONMENT,
    instructions: [],
    tools: [],
    ...overrides,
  };
}

async function collect(iterable: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function successfulProvider(): StubProvider {
  return new StubProvider([
    { type: "message_start", id: "response-1", model: "fixture" },
    { type: "thinking_delta", text: "consider" },
    { type: "text_delta", text: "hello " },
    { type: "text_delta", text: "world" },
    { type: "message_stop", response: COMPLETE_RESPONSE },
  ]);
}

it("journals the happy path in exact append-then-act order", async () => {
  const journal = new MemoryJournal();
  const provider = successfulProvider();
  const events = await collect(runTurn(input(provider, journal)));

  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual([
    "user_message",
    "prompt",
    "assistant_message",
    "turn_end",
  ]);
  expect(journal.appends.every(({ context }) => context.turn_id === "turn-1")).toBe(true);
  expect(provider.requests[0]?.messages.at(-1)).toEqual({ role: "user", content: "say hello" });
  expect(events.filter((event) => event.type === "text_delta")).toEqual([
    { type: "text_delta", text: "hello " },
    { type: "text_delta", text: "world" },
  ]);
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "completed" } });
});

it("does not call provider.stream before the prompt append settles (AC-10.2)", async () => {
  let releasePrompt: (() => void) | undefined;
  const journal = new MemoryJournal();
  const append = journal.append.bind(journal);
  journal.append = async (entry, context) => {
    const record = await append(entry, context);
    if (entry.kind === "prompt") {
      await new Promise<void>((resolve) => {
        releasePrompt = resolve;
      });
    }
    return record;
  };
  const provider = successfulProvider();
  const iterator = runTurn(input(provider, journal))[Symbol.asyncIterator]();

  expect((await iterator.next()).value).toMatchObject({
    type: "state",
    state: { phase: "building_context" },
  });
  const waiting = iterator.next();
  await Promise.resolve();
  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual(["user_message", "prompt"]);
  expect(provider.calls).toBe(0);
  releasePrompt?.();
  expect((await waiting).value).toMatchObject({
    type: "state",
    state: { phase: "waiting_for_model" },
  });
  expect(provider.calls).toBe(0);
  expect((await iterator.next()).value).toMatchObject({
    type: "state",
    state: { phase: "streaming_model" },
  });
  expect(provider.calls).toBe(1);
  await iterator.return?.();
});

it("journals an HTTP 500 as a retryable provider failure (AC-10.4)", async () => {
  const journal = new MemoryJournal();
  const provider = new StubProvider(
    [],
    new ProviderError("http", "upstream failed", undefined, 500),
  );
  const events = await collect(runTurn(input(provider, journal)));

  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual([
    "user_message",
    "prompt",
    "error",
    "turn_end",
  ]);
  expect(journal.appends[2]?.entry).toEqual({
    kind: "error",
    schemaVersion: 1,
    source: "provider",
    reason: "http",
    message: "upstream failed",
    status: 500,
    retryable: true,
  });
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "failed" } });
});

it("journals an interrupted partial after a mid-stream disconnect", async () => {
  const partial: ModelResponse = {
    content: [{ type: "text", text: "partial" }],
    tool_calls: [],
    usage: { kind: "unknown" },
    outcome: { kind: "interrupted", reason: "disconnected" },
  };
  const journal = new MemoryJournal();
  const provider = new StubProvider(
    [{ type: "text_delta", text: "partial" }],
    new ProviderError("disconnected", "socket closed", partial),
  );
  await collect(runTurn(input(provider, journal)));

  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual([
    "user_message",
    "prompt",
    "error",
    "assistant_message",
    "turn_end",
  ]);
  expect(journal.appends[3]?.entry).toMatchObject({
    schemaVersion: 2,
    outcome: { kind: "interrupted", reason: "disconnected" },
  });
});

it("treats an aborted provider call as interrupted rather than failed", async () => {
  const controller = new AbortController();
  controller.abort();
  const provider: ModelProvider = {
    async *stream(_request, signal) {
      if (signal.aborted) throw new ProviderError("aborted", "cancelled");
      yield* [] as ModelEvent[];
    },
  };
  const journal = new MemoryJournal();
  const events = await collect(runTurn(input(provider, journal, { signal: controller.signal })));

  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual([
    "user_message",
    "prompt",
    "turn_end",
  ]);
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "interrupted" } });
});

it("journals PromptError as a local failure", async () => {
  const session = readySession();
  session.toolCalls.push({
    kind: "tool_call",
    schemaVersion: 1,
    call_id: "call-1",
    tool: "read",
    input: {},
    capability: { risk_class: "read" },
  });
  const journal = new MemoryJournal();
  const events = await collect(runTurn(input(successfulProvider(), journal, { session })));

  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual([
    "user_message",
    "error",
    "turn_end",
  ]);
  expect(journal.appends[1]?.entry).toMatchObject({
    source: "local",
    reason: "unsupported-entry",
    retryable: false,
  });
  expect(events.at(-1)).toMatchObject({ type: "turn_end", state: { phase: "failed" } });
});

it("fails locally when session_start metadata is absent", async () => {
  const journal = new MemoryJournal();
  await collect(runTurn(input(successfulProvider(), journal, { session: baseSession() })));
  expect(journal.appends.map(({ entry }) => entry.kind)).toEqual([
    "user_message",
    "error",
    "turn_end",
  ]);
  expect(journal.appends[1]?.entry).toMatchObject({ source: "local", reason: "unexpected" });
});
