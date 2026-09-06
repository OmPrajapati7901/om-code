/** AC-7.1–7.8: deterministic injected transport; no socket is opened. */
import { readFileSync } from "node:fs";
import { type ModelEvent, ProviderError } from "@om-code/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/index.js";
import { chunk, collect, request, response, wire } from "./helpers.js";

const baseUrl = "https://endpoint.test/custom/v1/";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const signal = () => new AbortController().signal;
function provider(body: string) {
  return new OpenAICompatibleProvider({ baseUrl, fetchImpl: async () => response(body) });
}
function last(events: ModelEvent[]) {
  const event = events.at(-1);
  if (event?.type !== "message_stop") throw new Error("no stop");
  return event.response;
}

describe("text and usage (AC-7.1, 7.2, 7.4)", () => {
  it("retains usage-only chunks after finish and emits exactly one terminal event", async () => {
    const events = await collect(
      provider(
        wire(
          chunk({ role: "assistant", content: null }),
          chunk({ content: "one" }),
          chunk({ content: "two" }),
          chunk({}, "stop"),
          chunk({}, null, {
            choices: [],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, queue_time: 99 },
          }),
          "[DONE]",
        ),
      ).stream(request, signal()),
    );
    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(2);
    expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);
    expect(last(events)).toMatchObject({
      content: [{ type: "text", text: "onetwo" }],
      usage: { kind: "known", input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    });
  });
  it("yields text before the transport has completed", async () => {
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    const p = new OpenAICompatibleProvider({
      baseUrl,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              source = controller;
              controller.enqueue(new TextEncoder().encode(wire(chunk({ content: "early" }))));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    const iterator = p.stream(request, signal())[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "message_start" });
    expect((await iterator.next()).value).toEqual({ type: "text_delta", text: "early" });
    source?.enqueue(new TextEncoder().encode(wire(chunk({}, "stop"), "[DONE]")));
    expect((await iterator.next()).value).toMatchObject({ type: "message_stop" });
    await iterator.return?.();
  });
  it.each([
    undefined,
    null,
    {},
    { prompt_tokens: "4", completion_tokens: 2 },
    { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: 1.2, completion_tokens: 3 },
  ])("keeps missing/invalid usage unknown: %j", async (usage) => {
    const out = last(
      await collect(
        provider(wire(chunk({ content: "hi" }), chunk({}, "stop", { usage }), "[DONE]")).stream(
          request,
          signal(),
        ),
      ),
    );
    expect(out.usage).toEqual({ kind: "unknown" });
  });
  it("preserves reported zeros and accepts clean EOF after finish", async () => {
    const out = last(
      await collect(
        provider(
          wire(chunk({}, "stop", { usage: { prompt_tokens: 0, completion_tokens: 0 } })),
        ).stream(request, signal()),
      ),
    );
    expect(out.usage).toEqual({ kind: "known", input_tokens: 0, output_tokens: 0 });
  });
  it("maps normalized requests, omits absent auth, and allows disabling usage requests", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(wire(chunk({}, "stop"), "[DONE]")));
    const p = new OpenAICompatibleProvider({ baseUrl, fetchImpl, includeUsage: false });
    await collect(
      p.stream(
        {
          ...request,
          messages: [
            ...request.messages,
            {
              role: "assistant",
              content: "",
              tool_calls: [{ index: 0, call_id: "c", name: "read", arguments_raw: '{ "x": 1, }' }],
            },
            { role: "tool", call_id: "c", content: "ok" },
          ],
          tools: [{ name: "read", description: "Read", parameters: { type: "object" } }],
          tool_choice: { name: "read" },
        },
        signal(),
      ),
    );
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://endpoint.test/custom/v1/chat/completions");
    const init = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(body.stream_options).toBeUndefined();
    expect(body.messages[1].tool_calls[0].function.arguments).toBe('{ "x": 1, }');
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "c", content: "ok" });
    expect(body.tools[0].function.name).toBe("read");
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "read" } });
  });
});

describe("tool calls (AC-7.3)", () => {
  it.each(["text", "tool"])("replays recorded Groq %s payloads", async (name) => {
    const body = readFileSync(new URL(`./fixtures/groq-${name}.sse`, import.meta.url), "utf8");
    const out = last(await collect(provider(body).stream(request, signal())));
    expect(out.outcome.kind).toBe("complete");
    expect(out.usage.kind).toBe("known");
    if (name === "tool")
      expect(out.tool_calls[0]).toMatchObject({
        name: "get_weather",
        arguments_raw: '{"city":"Paris"}',
      });
  });
  it("accumulates interleaved sparse calls and fragmented names without parsing arguments", async () => {
    const out = last(
      await collect(
        provider(
          wire(
            chunk({
              tool_calls: [
                { index: 3, id: "b", function: { name: "re", arguments: '{"x":' } },
                { index: 0, id: "a", function: { name: "grep" } },
              ],
            }),
            chunk({
              tool_calls: [
                { index: 0, function: { arguments: "{'bad':1,}" } },
                { index: 3, function: { name: "ad", arguments: "2}" } },
              ],
            }),
            chunk({}, "stop"),
            "[DONE]",
          ),
        ).stream(request, signal()),
      ),
    );
    expect(out.tool_calls).toEqual([
      { index: 0, call_id: "a", name: "grep", arguments_raw: "{'bad':1,}" },
      { index: 3, call_id: "b", name: "read", arguments_raw: '{"x":2}' },
    ]);
  });
  it.each([
    { calls: [{ id: "c", function: { name: "read" } }] },
    {
      calls: [
        { index: 0, id: "a" },
        { index: 0, id: "b" },
      ],
    },
    {
      calls: [
        { index: 0, id: "a" },
        { index: 1, id: "a" },
      ],
    },
    { calls: [{ index: 0, function: { arguments: "{}" } }] },
  ])("rejects ambiguous or incomplete call metadata", async ({ calls }) => {
    await expect(
      collect(
        provider(wire(chunk({ tool_calls: calls }), chunk({}, "tool_calls"), "[DONE]")).stream(
          request,
          signal(),
        ),
      ),
    ).rejects.toMatchObject({ kind: "malformed-stream" });
  });
  it("retains observed reasoning field by field name", async () => {
    const out = last(
      await collect(
        provider(
          wire(
            chunk({ reasoning_content: "think" }),
            chunk({ content: "answer" }),
            chunk({}, "stop"),
            "[DONE]",
          ),
        ).stream(request, signal()),
      ),
    );
    expect(out.content).toEqual([
      { type: "thinking", text: "think" },
      { type: "text", text: "answer" },
    ]);
  });
});

describe("retry semantics (AC-7.6)", () => {
  it("retries 429/5xx up to maxRetries, then fails with the last status", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("limited", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(new Response("upstream", { status: 503 }))
      .mockImplementation(async () => response(wire(chunk({}, "stop"), "[DONE]")));
    const result = collect(
      new OpenAICompatibleProvider({ baseUrl, fetchImpl }).stream(request, signal()),
    );
    const check = expect(result).resolves.toHaveLength(2);
    await vi.runAllTimersAsync();
    await check;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const fail = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("upstream", { status: 503 }));
    const exhausted = expect(
      collect(new OpenAICompatibleProvider({ baseUrl, fetchImpl: fail }).stream(request, signal())),
    ).rejects.toMatchObject({ kind: "http", status: 503 });
    await vi.runAllTimersAsync();
    await exhausted;
    expect(fail).toHaveBeenCalledTimes(3);
  });
  it.each([400, 401, 403, 404, 409])(
    "does not retry HTTP %s and redacts echoed credentials",
    async (status) => {
      const key = "PRIVATE_SENTINEL_CREDENTIAL";
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ error: { message: `failed ${key}` } }), { status }),
        );
      const error = await collect(
        new OpenAICompatibleProvider({ baseUrl, fetchImpl, getApiKey: () => key }).stream(
          request,
          signal(),
        ),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.message).toContain("[redacted]");
      expect(error.message).not.toContain(key);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it("retries a transport failure before headers arrive", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("socket failure"))
      .mockImplementation(async () => response(wire(chunk({}, "stop"), "[DONE]")));
    const checked = expect(
      collect(new OpenAICompatibleProvider({ baseUrl, fetchImpl }).stream(request, signal())),
    ).resolves.toHaveLength(2);
    await vi.runAllTimersAsync();
    await checked;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("disconnect/cancellation (AC-7.7, 7.8)", () => {
  it("retains partial output on a real stream read error without retrying", async () => {
    let reads = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            pull(source) {
              if (reads++ === 0)
                source.enqueue(new TextEncoder().encode(wire(chunk({ content: "partial" }))));
              else source.error(new TypeError("socket terminated"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    await expect(
      collect(new OpenAICompatibleProvider({ baseUrl, fetchImpl }).stream(request, signal())),
    ).rejects.toMatchObject({
      kind: "disconnected",
      partial: { content: [{ type: "text", text: "partial" }] },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the overall request deadline before headers", async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl,
      requestTimeoutMs: 10,
      fetchImpl: () => new Promise(() => {}),
    });
    await expect(collect(p.stream(request, signal()))).rejects.toMatchObject({ kind: "stalled" });
  });

  it("bounds non-SSE error bodies and cancels the source", async () => {
    const cancel = vi.fn();
    const p = new OpenAICompatibleProvider({
      baseUrl,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(source) {
              source.enqueue(new TextEncoder().encode("x".repeat(10_000)));
            },
            cancel,
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    const error = await collect(p.stream(request, signal())).catch((e) => e);
    expect(error).toMatchObject({ kind: "http", status: 200 });
    expect(error.message.length).toBeLessThanOrEqual(8192);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("handles a missing response body as a typed stream error", async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl,
      fetchImpl: async () =>
        new Response(null, { headers: { "content-type": "text/event-stream" } }),
    });
    await expect(collect(p.stream(request, signal()))).rejects.toMatchObject({
      kind: "malformed-stream",
    });
  });
  it.each([false, true])(
    "journaling snapshot preserves partial %s tool/text on disconnect",
    async (tool) => {
      const delta = tool
        ? { tool_calls: [{ index: 0, function: { arguments: '{"unfinished":' } }] }
        : { content: "partial" };
      const error = await collect(provider(wire(chunk(delta))).stream(request, signal())).catch(
        (e) => e,
      );
      expect(error).toMatchObject({
        kind: "disconnected",
        partial: {
          outcome: { kind: "interrupted", reason: "disconnected" },
          usage: { kind: "unknown" },
        },
      });
      if (tool) expect(error.partial.tool_calls[0].arguments_raw).toBe('{"unfinished":');
      else expect(error.partial.content[0].text).toBe("partial");
    },
  );
  it.each([false, true])(
    "forwards abort, cancels the source and returns within 1s for tool=%s",
    async (tool) => {
      const controller = new AbortController();
      const cancel = vi.fn();
      const delta = tool
        ? { tool_calls: [{ index: 0, id: "c", function: { name: "read", arguments: "{" } }] }
        : { content: "partial" };
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            new ReadableStream({
              start(source) {
                source.enqueue(new TextEncoder().encode(wire(chunk(delta))));
              },
              cancel,
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      );
      const stream = new OpenAICompatibleProvider({ baseUrl, fetchImpl })
        .stream(request, controller.signal)
        [Symbol.asyncIterator]();
      await stream.next();
      await stream.next();
      const pending = stream.next();
      const start = performance.now();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ kind: "aborted" });
      expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(performance.now() - start).toBeLessThan(1000);
    },
  );
  it("cleans up on early return and catches an idle stream", async () => {
    const cancel = vi.fn();
    const make = () =>
      new Response(
        new ReadableStream({
          start(source) {
            source.enqueue(new TextEncoder().encode(wire(chunk({ content: "early" }))));
          },
          cancel,
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const p = new OpenAICompatibleProvider({
      baseUrl,
      fetchImpl: async () => make(),
      idleTimeoutMs: 10,
    });
    for await (const _event of p.stream(request, signal())) break;
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(collect(p.stream(request, signal()))).rejects.toMatchObject({ kind: "stalled" });
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it("aborts before headers even when an injected fetch ignores its signal", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const work = collect(
      new OpenAICompatibleProvider({ baseUrl, fetchImpl }).stream(request, controller.signal),
    );
    controller.abort();
    await expect(work).rejects.toMatchObject({ kind: "aborted" });
  });
  it("aborts retry backoff without another transport request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("wait", { status: 503 }));
    const checked = expect(
      collect(
        new OpenAICompatibleProvider({ baseUrl, fetchImpl }).stream(request, controller.signal),
      ),
    ).rejects.toMatchObject({ kind: "aborted" });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.runAllTimersAsync();
    await checked;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    "data: not-json\n\n",
    wire(
      chunk({}, null, {
        choices: [
          { index: 0, delta: {} },
          { index: 1, delta: {} },
        ],
      }),
    ),
    wire(chunk({}), "[DONE]"),
  ])("rejects malformed/premature streams", async (body) => {
    await expect(collect(provider(body).stream(request, signal()))).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});

describe("credential and configuration privacy", () => {
  it("ignores ambient credentials and endpoint env vars", async () => {
    for (const name of [
      "OPENAI_API_KEY",
      "OPENAI_ADMIN_KEY",
      "OPENAI_ORGANIZATION",
      "OPENAI_PROJECT_ID",
      "LANGSMITH_API_KEY",
    ])
      vi.stubEnv(name, "AMBIENT_SENTINEL");
    vi.stubEnv("OPENAI_BASE_URL", "https://wrong.test/v1");
    vi.stubEnv("OPENAI_LOG", "debug");
    const unexpected = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected network"));
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response(wire(chunk({ content: "private content" }), chunk({}, "stop"), "[DONE]")),
      );
    await collect(new OpenAICompatibleProvider({ baseUrl, fetchImpl }).stream(request, signal()));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unexpected).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://endpoint.test/custom/v1/chat/completions");
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    for (const name of ["authorization", "openai-organization", "openai-project"])
      expect(headers.has(name)).toBe(false);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("does not log malformed SSE payloads", async () => {
    vi.stubEnv("OPENAI_LOG", "debug");
    const errorLog = vi.spyOn(console, "error");
    const error = await collect(
      provider("data: MALFORMED_PRIVATE_SENTINEL\n\n").stream(request, signal()),
    ).catch((e) => e);
    expect(error).toMatchObject({ kind: "malformed-stream" });
    expect(String(error)).not.toContain("MALFORMED_PRIVATE_SENTINEL");
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("can disable retries and validates the two-retry ceiling", async () => {
    for (const maxRetries of [-1, 3, 1.5, NaN])
      expect(() => new OpenAICompatibleProvider({ baseUrl, maxRetries })).toThrow("maxRetries");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("bad", { status: 503 }));
    await expect(
      collect(
        new OpenAICompatibleProvider({ baseUrl, fetchImpl, maxRetries: 0 }).stream(
          request,
          signal(),
        ),
      ),
    ).rejects.toMatchObject({ kind: "http", status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses explicit credentials without falling back to an ambient key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "AMBIENT_SENTINEL");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(wire(chunk({}, "stop"), "[DONE]")));
    await collect(
      new OpenAICompatibleProvider({
        baseUrl,
        fetchImpl,
        getApiKey: () => "EXPLICIT_SENTINEL",
      }).stream(request, signal()),
    );
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer EXPLICIT_SENTINEL",
    );
  });
});

describe("SSE framing and initial wait limits", () => {
  it.each(["\n", "\r\n", "\r"])(
    "decodes UTF-8 at every byte boundary with %j framing",
    async (newline) => {
      const first = JSON.stringify(chunk({ content: "雪😀 café" }));
      const split = first.indexOf(',"choices"');
      const text = [
        ": comment",
        "event: message",
        `data: ${first.slice(0, split + 1)}`,
        `data: ${first.slice(split + 1)}`,
        "",
        `data: ${JSON.stringify(chunk({}, "stop"))}`,
        "",
        "data: [DONE]",
        "",
        "",
      ].join(newline);
      const bytes = new TextEncoder().encode(text);
      const fetchImpl: typeof fetch = async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      const out = last(
        await collect(
          new OpenAICompatibleProvider({ baseUrl, fetchImpl }).stream(request, signal()),
        ),
      );
      expect(out.content).toEqual([{ type: "text", text: "雪😀 café" }]);
    },
  );

  it("times out waiting for the first chunk, not only subsequent chunks", async () => {
    const cancel = vi.fn();
    const fetchImpl: typeof fetch = async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { "content-type": "text/event-stream" },
      });
    await expect(
      collect(
        new OpenAICompatibleProvider({ baseUrl, fetchImpl, idleTimeoutMs: 10 }).stream(
          request,
          signal(),
        ),
      ),
    ).rejects.toMatchObject({
      kind: "stalled",
      partial: { outcome: { kind: "interrupted", reason: "stalled" } },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("redacts a credential echoed by a streamed error without retrying", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response(wire(chunk({ content: "kept" }), { error: { message: "failed ECHO_SENTINEL" } })),
      );
    const error = await collect(
      new OpenAICompatibleProvider({ baseUrl, fetchImpl, getApiKey: () => "ECHO_SENTINEL" }).stream(
        request,
        signal(),
      ),
    ).catch((error) => error);
    expect(error).toMatchObject({ partial: { content: [{ type: "text", text: "kept" }] } });
    expect(String(error)).not.toContain("ECHO_SENTINEL");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
