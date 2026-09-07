import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ModelEvent, ModelProvider, ModelRequest } from "@om-code/protocol";
import { ProviderError, parseRecord } from "@om-code/protocol";
import { FakeProvider, type FakeScript } from "@om-code/providers";
import { materialize } from "@om-code/session";
import { JournalReader, listSessions, loadSettings } from "@om-code/storage";
import { v7 } from "uuid";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import type { CliDeps } from "../src/types.js";

const roots: string[] = [];

async function project(): Promise<{ root: string; omHome: string }> {
  const root = await mkdtemp(join(tmpdir(), "om-cli-"));
  roots.push(root);
  const projectRoot = join(root, "project");
  await mkdir(join(projectRoot, ".git"), { recursive: true });
  return { root: projectRoot, omHome: join(root, "home") };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

type Harness = {
  readonly deps: CliDeps;
  readonly input: PassThrough;
  readonly stdout: string[];
  readonly stderr: string[];
};

function harness(
  root: string,
  omHome: string,
  provider: ModelProvider,
  inputText = "",
  overrides: Partial<Pick<CliDeps, "createProvider" | "newId">> = {},
  keepInputOpen = false,
): Harness {
  const input = new PassThrough();
  const output = new PassThrough();
  if (keepInputOpen) {
    if (inputText.length > 0) input.write(inputText);
  } else {
    input.end(inputText);
  }
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    input,
    stdout,
    stderr,
    deps: {
      host: { platform: "darwin", arch: "arm64" },
      env: {
        OM_HOME: omHome,
        OM_BASE_URL: "https://fixture.test/v1",
        OM_MODEL: "fixture-model",
      },
      cwd: root,
      loadSettings: (options) => loadSettings(options),
      io: {
        write: (text) => stdout.push(text),
        writeErr: (text) => stderr.push(text),
        input,
        output,
        isTty: false,
      },
      now: () => new Date("2026-09-06T12:00:00Z"),
      newId: overrides.newId ?? (() => v7()),
      createProvider: overrides.createProvider ?? (() => provider),
      osLabel: "darwin/arm64",
    },
  };
}

function textTurns(...answers: string[]): FakeScript {
  return {
    turns: answers.map((answer) => ({
      kind: "stream" as const,
      deltas: [{ text: answer.slice(0, 1) }, { text: answer.slice(1) }],
    })),
  };
}

async function onlySession(root: string, omHome: string) {
  const location = { projectRoot: root, omHome };
  const sessions = await listSessions(location);
  expect(sessions).toHaveLength(1);
  const sessionId = sessions[0]?.sessionId;
  if (sessionId === undefined) throw new Error("missing session");
  const records = (await new JournalReader(location).readAll(sessionId)).records;
  return { sessionId, records, view: materialize(records) };
}

describe("om run", () => {
  it("AC-11.1 holds three turns in one REPL process and one journal", async () => {
    const location = await project();
    const provider = new FakeProvider(textTurns("first", "second", "third"));
    const cli = harness(location.root, location.omHome, provider, "one\ntwo\nthree\n");
    const result = await runCli(["run"], cli.deps);

    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(provider.requests).toHaveLength(3);
    expect(cli.stdout.join("")).toBe("first\nsecond\nthird\n");
    const { records, view } = await onlySession(location.root, location.omHome);
    expect(records.filter((record) => record.entry.kind === "user_message")).toHaveLength(3);
    expect(
      records.filter(
        (record) => record.entry.kind === "assistant_message" && record.entry.schemaVersion === 2,
      ),
    ).toHaveLength(3);
    expect(view.meta?.status).toBe("idle");
  });

  it("AC-11.2 keeps an interrupted turn and accepts another before Ctrl-D", async () => {
    const location = await project();
    const provider = new FakeProvider({
      turns: [
        {
          kind: "stream",
          deltas: [{ text: "partial" }],
          interrupt: "aborted",
        },
        { kind: "stream", deltas: [{ text: "recovered" }] },
      ],
    });
    const cli = harness(location.root, location.omHome, provider, "interrupt me\ncontinue\n");
    const result = await runCli(["run"], cli.deps);

    expect(result.exitCode).toBe(0);
    expect(provider.requests).toHaveLength(2);
    expect(cli.stderr.join("")).toContain("turn interrupted; session kept");
    const { view } = await onlySession(location.root, location.omHome);
    expect(view.meta?.status).toBe("idle");
    expect(view.resumable).toBe(true);
    const assistants = view.conversation.filter((entry) => entry.kind === "assistant_message");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]).toMatchObject({ outcome: { kind: "interrupted", reason: "aborted" } });
    expect(assistants[1]).toMatchObject({ outcome: { kind: "complete" } });
  });

  it("AC-11.2 aborts an in-flight TTY turn on Ctrl-C and keeps reading", async () => {
    const location = await project();
    let turn = 0;
    let entered: (() => void) | undefined;
    const streaming = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let observedAbort: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      observedAbort = resolve;
    });
    const provider: ModelProvider = {
      async *stream(request, signal) {
        turn += 1;
        if (turn === 1) {
          yield { type: "message_start", id: "interrupt-live", model: request.model };
          yield { type: "text_delta", text: "partial" };
          entered?.();
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                observedAbort?.();
                resolve();
              },
              { once: true },
            );
          });
          throw new ProviderError("aborted", "request aborted", {
            content: [{ type: "text", text: "partial" }],
            tool_calls: [],
            usage: { kind: "unknown" },
            outcome: { kind: "interrupted", reason: "aborted" },
          });
        }
        yield { type: "message_start", id: "after-interrupt", model: request.model };
        yield { type: "text_delta", text: "recovered" };
        yield {
          type: "message_stop",
          response: {
            content: [{ type: "text", text: "recovered" }],
            tool_calls: [],
            usage: { kind: "unknown" },
            outcome: { kind: "complete" },
          },
        };
      },
    };
    const cli = harness(location.root, location.omHome, provider, "", {}, true);
    (cli.deps.io as { isTty: boolean }).isTty = true;
    const pending = runCli(["run"], cli.deps);
    cli.input.write("interrupt\n");
    await streaming;
    cli.input.emit("om-interrupt");
    await aborted;
    cli.input.end("continue\n");

    expect((await pending).exitCode).toBe(0);
    expect(cli.stderr.join("")).toContain("turn interrupted; session kept");
    expect(cli.stdout.join("")).toContain("recovered");
    const { view } = await onlySession(location.root, location.omHome);
    expect(view.meta?.status).toBe("idle");
    expect(view.conversation).toHaveLength(4);
  });

  it("AC-11.3 runs -p as one shot", async () => {
    const location = await project();
    const provider = new FakeProvider(textTurns("answer"));
    const cli = harness(location.root, location.omHome, provider);
    const result = await runCli(["run", "-p", "question"], cli.deps);

    expect(result.exitCode).toBe(0);
    expect(provider.requests).toHaveLength(1);
    expect(cli.stdout.join("")).toBe("answer\n");
    const { view } = await onlySession(location.root, location.omHome);
    expect(view.conversation).toHaveLength(2);
  });

  it("AC-11.4 renders a delta while the provider stream is still open", async () => {
    const location = await project();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let deltaSeen: (() => void) | undefined;
    const seen = new Promise<void>((resolve) => {
      deltaSeen = resolve;
    });
    const provider: ModelProvider = {
      async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
        yield { type: "message_start", id: "blocked", model: request.model };
        yield { type: "text_delta", text: "visible-now" };
        deltaSeen?.();
        await gate;
        yield {
          type: "message_stop",
          response: {
            content: [{ type: "text", text: "visible-now" }],
            tool_calls: [],
            usage: { kind: "unknown" },
            stop_reason: "stop",
            outcome: { kind: "complete" },
          },
        };
      },
    };
    const cli = harness(location.root, location.omHome, provider);
    const pending = runCli(["run", "-p", "question"], cli.deps);
    await seen;

    expect(cli.stdout.join("")).toBe("visible-now");
    const { records } = await onlySession(location.root, location.omHome);
    expect(records.some((record) => record.entry.kind === "turn_end")).toBe(false);
    release?.();
    expect((await pending).exitCode).toBe(0);
  });

  it("AC-11.7 maps provider failure to exit 1", async () => {
    const location = await project();
    const cli = harness(
      location.root,
      location.omHome,
      new FakeProvider({ turns: [{ kind: "http-error", status: 500, message: "upstream down" }] }),
    );
    const result = await runCli(["run", "-p", "question"], cli.deps);

    expect(result.exitCode).toBe(1);
    expect(cli.stderr.join("")).toBe("om: upstream down\n");
    const { view } = await onlySession(location.root, location.omHome);
    expect(view.errors[0]).toMatchObject({ source: "provider", status: 500 });
    expect(view.meta?.status).toBe("idle");
  });

  it("AC-19.5 stops an agent run at --max-turns with exit 3 and a journaled reason", async () => {
    const location = await project();
    const provider = new FakeProvider({
      turns: [
        {
          kind: "stream",
          deltas: [
            { tool: { index: 0, call_id: "c1", name: "grep", arguments: '{"pattern":"x"}' } },
          ],
        },
        { kind: "stream", deltas: [{ text: "never inferred" }] },
      ],
    });
    const cli = harness(location.root, location.omHome, provider);
    const result = await runCli(["run", "-p", "question", "--max-turns", "1"], cli.deps);

    expect(result.exitCode).toBe(3);
    expect(provider.requests).toHaveLength(1);
    const { view } = await onlySession(location.root, location.omHome);
    expect(view.errors.at(-1)).toMatchObject({
      source: "local",
      reason: "max-turns",
      retryable: false,
    });
  });

  it("AC-19.6 enforces --max-cost within one in-flight call when pricing and usage exist", async () => {
    const location = await project();
    const provider = new FakeProvider({
      turns: [
        {
          kind: "stream",
          deltas: [{ text: "pricey" }],
          usage: { input_tokens: 1000, output_tokens: 0 },
        },
      ],
    });
    const cli = harness(location.root, location.omHome, provider);
    cli.deps.env.OM_PRICING_INPUT_PER_MTOK = "1000";
    cli.deps.env.OM_PRICING_OUTPUT_PER_MTOK = "1000";
    const result = await runCli(["run", "-p", "question", "--max-cost", "0.5"], cli.deps);

    expect(result.exitCode).toBe(3);
    const { view } = await onlySession(location.root, location.omHome);
    expect(view.errors.at(-1)).toMatchObject({ source: "local", reason: "max-cost" });
  });

  it("AC-19.6 aborts with exit 1 when pricing exists but the endpoint reports no usage", async () => {
    const location = await project();
    const provider = new FakeProvider(textTurns("mystery"));
    const cli = harness(location.root, location.omHome, provider);
    cli.deps.env.OM_PRICING_INPUT_PER_MTOK = "1000";
    cli.deps.env.OM_PRICING_OUTPUT_PER_MTOK = "1000";
    const result = await runCli(["run", "-p", "question", "--max-cost", "10"], cli.deps);

    expect(result.exitCode).toBe(1);
    expect(cli.stderr.join("")).toContain("no usage");
    const { view } = await onlySession(location.root, location.omHome);
    expect(view.errors.at(-1)).toMatchObject({
      source: "local",
      reason: "max-cost-unknown-usage",
    });
  });

  it("AC-11.8 emits only schema-valid journal records as NDJSON", async () => {
    const location = await project();
    const cli = harness(location.root, location.omHome, new FakeProvider(textTurns("one-shot")));
    const result = await runCli(["run", "-p=question", "--json"], cli.deps);

    expect(result.exitCode).toBe(0);
    const lines = cli.stdout.join("").trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const parsed = parseRecord(JSON.parse(line));
      expect(parsed.ok).toBe(true);
    }
  });

  it("records the selected read_only mode as protocol plan mode", async () => {
    const location = await project();
    const cli = harness(location.root, location.omHome, new FakeProvider(textTurns("ok")));
    expect((await runCli(["run", "-p", "q", "--mode", "read_only"], cli.deps)).exitCode).toBe(0);
    expect((await onlySession(location.root, location.omHome)).view.meta?.mode).toBe("plan");
  });
});

describe("session inspection", () => {
  it("AC-11.5 lists newest first with id, status and last activity", async () => {
    const location = await project();
    for (const answer of ["older", "newer"]) {
      const cli = harness(location.root, location.omHome, new FakeProvider(textTurns(answer)));
      expect((await runCli(["run", "-p", answer], cli.deps)).exitCode).toBe(0);
    }
    const listed = await listSessions({
      projectRoot: location.root,
      omHome: location.omHome,
    });
    const inspect = harness(location.root, location.omHome, new FakeProvider({ turns: [] }), "", {
      createProvider: () => {
        throw new Error("sessions must not create a provider");
      },
    });
    const result = await runCli(["sessions"], inspect.deps);
    const output = inspect.stdout.join("");

    expect(result.exitCode).toBe(0);
    expect(output).toContain("status");
    expect(output).toContain("last activity");
    expect(output.indexOf(listed[0]?.sessionId ?? "missing")).toBeLessThan(
      output.indexOf(listed[1]?.sessionId ?? "missing"),
    );
    expect(output.match(/idle/g)).toHaveLength(2);
  });

  it("AC-11.6 show renders the journal without creating a provider", async () => {
    const location = await project();
    const run = harness(
      location.root,
      location.omHome,
      new FakeProvider(textTurns("journal answer")),
    );
    await runCli(["run", "-p", "journal question"], run.deps);
    const { sessionId } = await onlySession(location.root, location.omHome);
    const inspect = harness(location.root, location.omHome, new FakeProvider({ turns: [] }), "", {
      createProvider: () => {
        throw new Error("show must not create a provider");
      },
    });
    const result = await runCli(["show", sessionId], inspect.deps);

    expect(result.exitCode).toBe(0);
    expect(inspect.stdout.join("")).toContain("You: journal question");
    expect(inspect.stdout.join("")).toContain("Assistant: journal answer");
  });
});

describe("startup and locking failures", () => {
  it("incomplete config exits 1 with remediation before provider creation", async () => {
    const location = await project();
    const cli = harness(location.root, location.omHome, new FakeProvider({ turns: [] }), "", {
      createProvider: () => {
        throw new Error("provider must not be created");
      },
    });
    cli.deps.env.OM_BASE_URL = undefined;
    cli.deps.env.OM_MODEL = undefined;
    const result = await runCli(["run", "-p", "q"], cli.deps);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing required config");
    expect(result.stderr).toContain("baseUrl");
    expect(result.stderr).toContain("model");
  });

  it("rejects unknown mode and --max-cost at startup", async () => {
    const modeLocation = await project();
    const invalidMode = harness(
      modeLocation.root,
      modeLocation.omHome,
      new FakeProvider({ turns: [] }),
    );
    const modeResult = await runCli(["run", "-p", "q", "--mode", "auto"], invalidMode.deps);
    expect(modeResult.exitCode).toBe(1);
    expect(modeResult.stderr).toContain("read_only");

    const costLocation = await project();
    const invalidCost = harness(
      costLocation.root,
      costLocation.omHome,
      new FakeProvider({ turns: [] }),
    );
    const costResult = await runCli(["run", "-p", "q", "--max-cost", "1"], invalidCost.deps);
    expect(costResult.exitCode).toBe(1);
    expect(costResult.stderr).toContain("pricing is unconfigured");
  });

  it("a second run against the same locked session exits 1 cleanly", async () => {
    const location = await project();
    const sessionId = "018f5c7a-1111-7000-8000-000000000001";
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: (() => void) | undefined;
    const streaming = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked: ModelProvider = {
      async *stream(request) {
        entered?.();
        await gate;
        yield { type: "message_start", id: "done", model: request.model };
        yield {
          type: "message_stop",
          response: {
            content: [],
            tool_calls: [],
            usage: { kind: "unknown" },
            outcome: { kind: "complete" },
          },
        };
      },
    };
    const first = harness(location.root, location.omHome, blocked, "", {
      newId: () => sessionId,
    });
    const pending = runCli(["run", "-p", "hold"], first.deps);
    await streaming;
    const second = harness(location.root, location.omHome, new FakeProvider(textTurns("no")), "", {
      newId: () => sessionId,
    });
    const locked = await runCli(["run", "-p", "collide"], second.deps);

    expect(locked.exitCode).toBe(1);
    expect(locked.stderr).toContain("locked");
    release?.();
    expect((await pending).exitCode).toBe(0);
  });
});
