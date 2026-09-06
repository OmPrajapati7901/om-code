/** AC-8.1–8.3: FakeProvider scripting, multi-turn sequencing, determinism. */
import { readFileSync } from "node:fs";
import type { Usage } from "@om-code/protocol";
import { describe, expect, it } from "vitest";
import { FakeProvider, type FakeScript } from "../src/index.js";
import { collect, request } from "./helpers.js";

const signal = () => new AbortController().signal;

describe("FakeProvider scripting (AC-8.2)", () => {
  it("plays turns in order across successive stream() calls", async () => {
    const provider = new FakeProvider({
      turns: [
        { kind: "stream", deltas: [{ text: "first" }] },
        { kind: "stream", deltas: [{ text: "second" }] },
      ],
    });
    const first = await collect(provider.stream(request, signal()));
    const second = await collect(provider.stream(request, signal()));
    expect(first.filter((e) => e.type === "text_delta").map((e) => e.text)).toEqual(["first"]);
    expect(second.filter((e) => e.type === "text_delta").map((e) => e.text)).toEqual(["second"]);
    expect(provider.requests).toHaveLength(2);
  });

  it("throws a clear error when the script is exhausted", async () => {
    const provider = new FakeProvider({ turns: [{ kind: "stream", deltas: [{ text: "only" }] }] });
    await collect(provider.stream(request, signal()));
    await expect(collect(provider.stream(request, signal()))).rejects.toThrow(/script exhausted/);
  });

  it("absorbs a scripted 429 then succeeds, and a non-retriable 4xx fails immediately", async () => {
    const retried = new FakeProvider({
      turns: [
        [
          { kind: "http-error", status: 429 },
          { kind: "stream", deltas: [{ text: "ok" }] },
        ],
      ],
    });
    const events = await collect(retried.stream(request, signal()));
    expect(events.some((e) => e.type === "message_stop")).toBe(true);

    const rejected = new FakeProvider({ turns: [{ kind: "http-error", status: 401 }] });
    await expect(collect(rejected.stream(request, signal()))).rejects.toMatchObject({
      kind: "http",
      status: 401,
    });
  });

  it("reports unknown usage when the script supplies none, and known usage when it does", async () => {
    const unknown = new FakeProvider({ turns: [{ kind: "stream", deltas: [{ text: "hi" }] }] });
    const unknownEvents = await collect(unknown.stream(request, signal()));
    const unknownStop = unknownEvents.find((e) => e.type === "message_stop");
    if (unknownStop?.type !== "message_stop") throw new Error("no stop");
    expect(unknownStop.response.usage).toEqual<Usage>({ kind: "unknown" });

    const known = new FakeProvider({
      turns: [
        { kind: "stream", deltas: [{ text: "hi" }], usage: { input_tokens: 4, output_tokens: 2 } },
      ],
    });
    const knownEvents = await collect(known.stream(request, signal()));
    const knownStop = knownEvents.find((e) => e.type === "message_stop");
    if (knownStop?.type !== "message_stop") throw new Error("no stop");
    expect(knownStop.response.usage).toEqual<Usage>({
      kind: "known",
      input_tokens: 4,
      output_tokens: 2,
    });
  });

  it("rejects with a typed aborted error when the signal is already aborted", async () => {
    const provider = new FakeProvider({ turns: [{ kind: "stream", deltas: [{ text: "x" }] }] });
    const controller = new AbortController();
    controller.abort();
    await expect(collect(provider.stream(request, controller.signal))).rejects.toMatchObject({
      kind: "aborted",
    });
  });

  it("rejects mid-stream abort with the partial content captured", async () => {
    const provider = new FakeProvider({
      turns: [{ kind: "stream", deltas: [{ text: "one" }, { text: "two" }, { text: "three" }] }],
    });
    const controller = new AbortController();
    const iterator = provider.stream(request, controller.signal)[Symbol.asyncIterator]();
    await iterator.next(); // message_start
    await iterator.next(); // text_delta "one"
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({
      kind: "aborted",
      partial: { content: [{ type: "text", text: "one" }] },
    });
  });
});

describe("FakeProvider determinism (AC-8.3)", () => {
  const script: FakeScript = {
    turns: [
      {
        kind: "stream",
        deltas: [
          { text: "hello" },
          { tool: { index: 0, call_id: "c", name: "read", arguments: "{}" } },
        ],
      },
    ],
  };
  it("produces byte-identical output across fresh instances given the same script", async () => {
    const first = JSON.stringify(await collect(new FakeProvider(script).stream(request, signal())));
    const second = JSON.stringify(
      await collect(new FakeProvider(script).stream(request, signal())),
    );
    expect(first).toBe(second);
  });

  it("never calls a wall-clock or randomness API", () => {
    const source = readFileSync(new URL("../src/fake.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(
      /\bDate\.now\s*\(|\bMath\.random\s*\(|\bsetTimeout\s*\(|\bperformance\.now\s*\(/,
    );
  });
});
