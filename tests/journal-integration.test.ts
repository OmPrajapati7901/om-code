/** AC-6.4, AC-7.4 and AC-7.7 cross-package evidence. No production reverse edge. */
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemblePrompt, type JournalSink, runTurn, type ToolRunner } from "@om-code/kernel";
import { type Entry, type ModelResponse, ProviderError } from "@om-code/protocol";
import { FakeProvider, OpenAICompatibleProvider } from "@om-code/providers";
import { materialize } from "@om-code/session";
import { JournalReader, JournalWriter, journalPaths } from "@om-code/storage";
import fc from "fast-check";
import { afterEach, expect, it } from "vitest";
import { assertNoSecret } from "../packages/storage/tests/helpers/secret-guard.js";
import { adapterFor } from "./contract/adapter-fixtures.js";
import { contractRequest } from "./contract/provider.js";

const roots: string[] = [];
async function location() {
  const root = await mkdtemp(join(tmpdir(), "om-integration-"));
  roots.push(root);
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  return {
    projectRoot,
    omHome: join(root, "home"),
    sessionId: "0193b4c8-0000-7000-8000-000000000001",
  };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("AC-6.4 append/read/materialize agrees with an independent generated reference", async () => {
  const action = fc.oneof(
    fc.constantFrom<Entry>(
      {
        kind: "session_start",
        schemaVersion: 1,
        meta: {
          id: "0193b4c8-0000-7000-8000-000000000001",
          project_root: "/fixture",
          cwd: "/fixture",
          created_at: "2026-09-06T00:00:00Z",
          updated_at: "2026-09-06T00:00:00Z",
          status: "active",
          mode: "manual",
          model: { id: "fixture", base_url: "https://fixture.test" },
          tags: [],
        },
      },
      {
        kind: "permission",
        schemaVersion: 1,
        call_id: "c1",
        decision: "deny",
        scope: "once",
        decided_by: "user",
        reason: "test",
      },
      { kind: "checkpoint", schemaVersion: 1, files: [], restorable: false },
      {
        kind: "compaction",
        schemaVersion: 1,
        covers: { from: 1, to: 2 },
        summary: {
          goal: "test",
          decisions: [],
          constraints: [],
          changed_files: [],
          tests: [],
          failed_attempts: [],
          approved_permissions: [],
          open_questions: [],
          next_steps: [],
        },
      },
      { kind: "repair", schemaVersion: 1, reason: "fixture", truncated_from: 1 },
      { kind: "turn_end", schemaVersion: 1, usage: { kind: "unknown" } },
      {
        kind: "prompt",
        schemaVersion: 1,
        instructions: [{ path: "AGENTS.md", sha256: "3".repeat(64) }],
      },
      {
        kind: "assistant_message",
        schemaVersion: 2,
        content: [],
        tool_calls: [{ index: 0, arguments_raw: "{partial" }],
        usage: { kind: "unknown" },
        outcome: { kind: "interrupted", reason: "aborted" },
      },
    ),
    fc.string().map((text) => ({ kind: "user_message", schemaVersion: 1, text }) as const),
    fc.string().map(
      (text) =>
        ({
          kind: "assistant_message",
          schemaVersion: 1,
          content: [{ type: "text", text }],
          usage: { kind: "unknown" },
        }) as const,
    ),
    fc.tuple(fc.nat(4), fc.jsonValue()).map(
      ([id, input]) =>
        ({
          kind: "tool_call",
          schemaVersion: 1,
          call_id: `c${id}`,
          tool: "read",
          input,
          capability: { risk_class: "read" },
        }) as const,
    ),
    fc.nat(4).map(
      (id) =>
        ({
          kind: "tool_result",
          schemaVersion: 1,
          call_id: `c${id}`,
          preview: "result",
          bytes: 6,
          truncated: false,
          status: "ok",
        }) as const,
    ),
  );
  await fc.assert(
    fc.asyncProperty(fc.array(action, { maxLength: 30 }), async (actions) => {
      const loc = await location();
      const writer = await JournalWriter.open({ ...loc, hooks: { sync: async () => {} } });
      const expectedMessages: unknown[] = [];
      const pending = new Set<string>();
      for (const action of actions) {
        const entry = JSON.parse(JSON.stringify(action)) as Entry;
        await writer.append(entry, { by: "system" });
        if (entry.kind === "user_message" || entry.kind === "assistant_message")
          expectedMessages.push(entry);
        if (entry.kind === "tool_call") pending.add(entry.call_id);
        if (entry.kind === "tool_result") pending.delete(entry.call_id);
      }
      await writer.close();
      const reader = new JournalReader(loc);
      const before = await readFile(journalPaths(loc, loc.sessionId).journal);
      const first = await reader.readAll(loc.sessionId);
      const second = await reader.readAll(loc.sessionId);
      expect(first).toEqual(second);
      expect(await readFile(journalPaths(loc, loc.sessionId).journal)).toEqual(before);
      expect(first.records.map((record) => record.seq)).toEqual(
        actions.map((_, index) => index + 1),
      );
      expect(first.records.map((record) => record.entry)).toEqual(
        JSON.parse(JSON.stringify(actions)),
      );
      expect(materialize(first.records)).toEqual(materialize(second.records));
      expect(materialize(first.records)).toMatchObject({
        conversation: expectedMessages,
        pendingCallIds: [...pending],
        permissions: actions.filter((entry) => entry.kind === "permission"),
        checkpoints: actions.filter((entry) => entry.kind === "checkpoint"),
        compactions: actions.filter((entry) => entry.kind === "compaction"),
        repairs: actions.filter((entry) => entry.kind === "repair"),
        prompts: actions.filter((entry) => entry.kind === "prompt"),
        errors: actions.filter((entry) => entry.kind === "error"),
      });
    }),
    { numRuns: 50 },
  );
});

function sessionStartEntry(sessionId: string, projectRoot: string): Entry {
  return {
    kind: "session_start",
    schemaVersion: 1,
    meta: {
      id: sessionId,
      project_root: projectRoot,
      cwd: projectRoot,
      created_at: "2026-09-06T00:00:00Z",
      updated_at: "2026-09-06T00:00:00Z",
      status: "idle",
      mode: "manual",
      model: { id: "fixture", base_url: "https://fixture.test" },
      tags: [],
    },
  };
}

it("AC-10.3 reconstructs a completed turn exactly from the real journal", async () => {
  const loc = await location();
  const writer = await JournalWriter.open(loc);
  const start = await writer.append(sessionStartEntry(loc.sessionId, loc.projectRoot), {
    by: "system",
  });
  const sink: JournalSink = writer;
  const liveEvents = [];
  for await (const event of runTurn({
    session: materialize([start]),
    text: "hello",
    provider: new FakeProvider({
      turns: [
        {
          kind: "stream",
          deltas: [{ thinking: "briefly" }, { text: "hello" }, { text: " world" }],
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      ],
    }),
    journal: sink,
    newTurnId: () => "turn-1",
    signal: new AbortController().signal,
    model: "fixture",
    environment: {
      cwd: loc.projectRoot,
      projectRoot: loc.projectRoot,
      os: "darwin/arm64",
      date: "2026-09-06",
    },
    instructions: [],
    tools: [],
  })) {
    liveEvents.push(event);
  }
  const completed = liveEvents.find(
    (event) => event.type === "turn_end" && event.state.phase === "completed",
  );
  if (completed?.type !== "turn_end" || completed.state.phase !== "completed")
    throw new Error("missing completed turn event");
  await writer.close();

  const fromDisk = materialize((await new JournalReader(loc).readAll(loc.sessionId)).records);
  const assistant = fromDisk.conversation.find((entry) => entry.kind === "assistant_message");
  if (assistant?.schemaVersion !== 2) throw new Error("missing v2 assistant journal entry");
  expect(assistant).toEqual({
    kind: "assistant_message",
    schemaVersion: 2,
    ...completed.state.response,
  });
  expect(
    liveEvents
      .filter((event) => event.type === "text_delta")
      .map((event) => event.text)
      .join(""),
  ).toBe(
    assistant?.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
  );
  expect(fromDisk).toMatchObject({ resumable: true, meta: { status: "idle" } });
});

it("AC-10.4 keeps a provider-failed turn resumable after disk materialization", async () => {
  const loc = await location();
  const writer = await JournalWriter.open(loc);
  const start = await writer.append(sessionStartEntry(loc.sessionId, loc.projectRoot), {
    by: "system",
  });
  for await (const _event of runTurn({
    session: materialize([start]),
    text: "hello",
    provider: new FakeProvider({
      turns: [{ kind: "http-error", status: 500, message: "upstream unavailable" }],
    }),
    journal: writer,
    newTurnId: () => "turn-failed",
    signal: new AbortController().signal,
    model: "fixture",
    environment: {
      cwd: loc.projectRoot,
      projectRoot: loc.projectRoot,
      os: "darwin/arm64",
      date: "2026-09-06",
    },
    instructions: [],
    tools: [],
  })) {
    // Drain the async generator so all terminal records commit.
  }
  await writer.close();

  const fromDisk = materialize((await new JournalReader(loc).readAll(loc.sessionId)).records);
  expect(fromDisk).toMatchObject({
    resumable: true,
    diagnostics: [],
    meta: { status: "idle" },
    errors: [
      {
        source: "provider",
        reason: "http",
        status: 500,
        retryable: true,
      },
    ],
  });
});

it("LRN-09/AC-9.5 journals the instruction hashes assemblePrompt produces, not a module variable", async () => {
  const assembled = assemblePrompt({
    session: {
      meta: undefined,
      lastSeq: 0,
      lastActivityAt: undefined,
      conversation: [{ kind: "user_message", schemaVersion: 1, text: "hi" }],
      toolCalls: [],
      toolResults: [],
      pendingCallIds: [],
      permissions: [],
      checkpoints: [],
      compactions: [],
      repairs: [],
      prompts: [],
      errors: [],
      unknownEntries: [],
      diagnostics: [],
      resumable: false,
    },
    model: "fixture",
    environment: { cwd: "/repo", projectRoot: "/repo", os: "darwin/arm64", date: "2026-09-06" },
    instructions: [{ path: "AGENTS.md", sha256: "4".repeat(64), content: "guidelines" }],
    tools: [],
  });
  const loc = await location();
  const writer = await JournalWriter.open(loc);
  await writer.append(
    { kind: "prompt", schemaVersion: 1, instructions: [...assembled.instructions] },
    { by: "system" },
  );
  await writer.close();
  const read = await new JournalReader(loc).readAll(loc.sessionId);
  expect(materialize(read.records).prompts).toEqual([
    {
      kind: "prompt",
      schemaVersion: 1,
      instructions: [{ path: "AGENTS.md", sha256: "4".repeat(64) }],
    },
  ]);
});

it.each(["text", "truncated"] as const)(
  "unknown usage and %s output survive real journal storage",
  async (scenario) => {
    let response: ModelResponse | undefined;
    try {
      for await (const event of adapterFor(scenario).stream(
        contractRequest,
        new AbortController().signal,
      ))
        if (event.type === "message_stop") response = event.response;
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      response = error.partial;
    }
    expect(response).toBeDefined();
    if (!response) throw new Error("missing response");
    const loc = await location();
    const writer = await JournalWriter.open(loc);
    await writer.append(
      { kind: "assistant_message", schemaVersion: 2, ...response },
      { by: "model", turn_id: "turn" },
    );
    await writer.close();
    const read = await new JournalReader(loc).readAll(loc.sessionId);
    expect(response.usage).toEqual({ kind: "unknown" });
    expect(read.records[0]?.entry).toMatchObject(response);
  },
);

it.each([
  { reason: "disconnected", tool: false },
  { reason: "aborted", tool: false },
  { reason: "disconnected", tool: true },
  { reason: "aborted", tool: true },
] as const)("AC-7.7 journals $reason output exactly (tool: $tool)", async ({ reason, tool }) => {
  const raw = '{"path":"unfinished';
  const delta = tool
    ? { tool_calls: [{ index: 0, function: { arguments: raw } }] }
    : { content: raw };
  const body = `data: ${JSON.stringify({ id: "partial", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] })}\n\n`;
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://fixture.test",
    fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
  });
  let partial: ModelResponse | undefined;
  const controller = new AbortController();
  try {
    for await (const event of provider.stream(contractRequest, controller.signal)) {
      if (reason === "aborted" && event.type === (tool ? "tool_call_delta" : "text_delta"))
        controller.abort();
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    partial = error.partial;
  }
  if (!partial) throw new Error("missing partial");
  const loc = await location();
  const writer = await JournalWriter.open(loc);
  await writer.append({ kind: "assistant_message", schemaVersion: 2, ...partial }, { by: "model" });
  await writer.close();
  expect(
    materialize((await new JournalReader(loc).readAll(loc.sessionId)).records).conversation[0],
  ).toMatchObject({
    content: tool ? [] : [{ type: "text", text: raw }],
    tool_calls: tool ? [{ index: 0, arguments_raw: raw }] : [],
    outcome: { kind: "interrupted", reason },
  });
});

it("keeps adapter credentials out of journals, repair backups, fixtures and error output", async () => {
  const sentinel = "sk-journal-sentinel-do-not-store-64be781f";
  let authenticated = false;
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://fixture.test",
    getApiKey: () => sentinel,
    fetchImpl: async (_url, init) => {
      authenticated = new Headers(init?.headers).get("Authorization") === `Bearer ${sentinel}`;
      return new Response(JSON.stringify({ error: { message: `invalid key ${sentinel}` } }), {
        status: 401,
      });
    },
  });
  let diagnostic = "";
  try {
    for await (const _event of provider.stream(contractRequest, new AbortController().signal)) {
      throw new Error("HTTP failure must not emit events");
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    diagnostic = String(error);
  }
  expect(authenticated).toBe(true);
  expect(diagnostic).toContain("[redacted]");
  expect(diagnostic).not.toContain(sentinel);
  const loc = await location();
  let writer = await JournalWriter.open(loc);
  await writer.append(
    {
      kind: "assistant_message",
      schemaVersion: 2,
      content: [{ type: "text", text: diagnostic }],
      tool_calls: [],
      usage: { kind: "unknown" },
      outcome: { kind: "complete" },
    },
    { by: "system" },
  );
  await writer.close();
  const paths = journalPaths(loc, loc.sessionId);
  await appendFile(paths.journal, "{partial");
  writer = await JournalWriter.open(loc);
  await writer.close();
  expect((await readdir(paths.directory)).some((name) => name.includes(".corrupt."))).toBe(true);
  assertNoSecret(loc.omHome, sentinel);
  assertNoSecret(
    new URL("../packages/providers/tests/fixtures", import.meta.url).pathname,
    sentinel,
  );
});

it("AC-18.1/18.3 journals a multi-tool turn that re-assembles after disk readback", async () => {
  const loc = await location();
  const writer = await JournalWriter.open(loc);
  const start = await writer.append(sessionStartEntry(loc.sessionId, loc.projectRoot), {
    by: "system",
  });
  const toolRunner: ToolRunner = {
    run: async (call, deps) => {
      await deps.record({
        kind: "tool_call",
        schemaVersion: 1,
        call_id: call.call_id,
        tool: call.name,
        input: {},
        capability: { risk_class: "read" },
      });
      return {
        status: "ok",
        preview: `preview for ${call.call_id}`,
        bytes: 12,
        truncated: false,
      };
    },
  };
  for await (const _event of runTurn({
    session: materialize([start]),
    text: "where is auth handled?",
    provider: new FakeProvider({
      turns: [
        {
          kind: "stream",
          deltas: [
            {
              tool: {
                index: 0,
                call_id: "c1",
                name: "read",
                arguments: '{"path":"a.ts"}',
              },
            },
            {
              tool: {
                index: 1,
                call_id: "c2",
                name: "grep",
                arguments: '{"pattern":"auth"}',
              },
            },
          ],
        },
        { kind: "stream", deltas: [{ text: "auth lives in a.ts" }] },
      ],
    }),
    journal: writer,
    newTurnId: () => "turn-tools",
    signal: new AbortController().signal,
    model: "fixture",
    environment: {
      cwd: loc.projectRoot,
      projectRoot: loc.projectRoot,
      os: "darwin/arm64",
      date: "2026-09-06",
    },
    instructions: [],
    tools: [
      { name: "read", description: "read", parameters: {} },
      { name: "grep", description: "grep", parameters: {} },
    ],
    toolRunner,
  })) {
    // Drain so every record commits.
  }
  await writer.close();

  const records = (await new JournalReader(loc).readAll(loc.sessionId)).records;
  const view = materialize(records);
  expect(view.toolCalls.map((entry) => entry.call_id).sort()).toEqual(["c1", "c2"]);
  expect(view.toolResults.map((entry) => entry.call_id).sort()).toEqual(["c1", "c2"]);
  expect(view.pendingCallIds).toEqual([]);
  const callSeq = new Map(
    records
      .filter((r) => r.entry.kind === "tool_call")
      .map((r) => [r.entry.kind === "tool_call" ? r.entry.call_id : "", r.seq]),
  );
  const resultSeq = new Map(
    records
      .filter((r) => r.entry.kind === "tool_result")
      .map((r) => [r.entry.kind === "tool_result" ? r.entry.call_id : "", r.seq]),
  );
  for (const id of ["c1", "c2"]) {
    expect(callSeq.get(id)).toBeLessThan(resultSeq.get(id) ?? 0);
  }

  const environment = {
    cwd: loc.projectRoot,
    projectRoot: loc.projectRoot,
    os: "darwin/arm64",
    date: "2026-09-06",
  };
  const first = assemblePrompt({
    session: view,
    model: "fixture",
    environment,
    instructions: [],
    tools: [],
  });
  const second = assemblePrompt({
    session: materialize((await new JournalReader(loc).readAll(loc.sessionId)).records),
    model: "fixture",
    environment,
    instructions: [],
    tools: [],
  });
  expect(second.request.messages).toEqual(first.request.messages);
  const toolMessages = first.request.messages.filter((message) => message.role === "tool");
  expect(toolMessages).toHaveLength(2);
  expect(toolMessages[0]).toMatchObject({ call_id: "c1", content: "preview for c1" });
  expect(toolMessages[1]).toMatchObject({ call_id: "c2", content: "preview for c2" });
});
