/**
 * The stub port contract (LRN-12, AC-12.1–12.3, AC-12.5).
 *
 * AC-12.1 and AC-12.2 are enforced by the type system — tsc failing IS the
 * check doing its job — with runtime assertions alongside. AC-12.3 pins the
 * streaming shape. AC-12.5 (no driver code) is asserted by the absence of
 * file/process imports here and in src (see the verification grep).
 */

import type {
  BatchParams,
  ExecParams,
  GlobParams,
  GrepParams,
  HealthParams,
  ReadParams,
  ShellParams,
  StatParams,
  StubEnvelope,
  StubFrame,
  WriteParams,
} from "@om-code/protocol";
import {
  batchParamsSchema,
  execParamsSchema,
  globParamsSchema,
  grepParamsSchema,
  healthParamsSchema,
  readParamsSchema,
  shellParamsSchema,
  statParamsSchema,
  stubEnvelopeSchema,
  writeParamsSchema,
} from "@om-code/protocol";
import { describe, expect, it } from "vitest";
import { STUB_METHODS, type StubClient, type StubMethod } from "../src/index.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const methodSetIsExact: Equal<keyof StubClient, StubMethod> = true;

type AllParamsExtendEnvelope = {
  [M in keyof StubClient]: Parameters<StubClient[M]>[0] extends StubEnvelope ? true : never;
};

const allParamsExtendEnvelope: AllParamsExtendEnvelope = {
  health: true,
  read: true,
  write: true,
  stat: true,
  glob: true,
  grep: true,
  exec: true,
  shell: true,
  batch: true,
};

type NonStreamingMethod = "health" | "write" | "stat" | "glob" | "batch";

type AllResultsExtendFrame = {
  [M in NonStreamingMethod]: Awaited<ReturnType<StubClient[M]>> extends StubFrame ? true : never;
};

const allResultsExtendFrame: AllResultsExtendFrame = {
  health: true,
  write: true,
  stat: true,
  glob: true,
  batch: true,
};

describe("stub port method set (AC-12.1)", () => {
  it("pins the method set to exactly nine via the type system", () => {
    expect(methodSetIsExact).toBe(true);
    expect(allParamsExtendEnvelope.health).toBe(true);
    expect(allResultsExtendFrame.health).toBe(true);
  });

  it("declares exactly blueprint §8.2's nine methods, no more, no fewer", () => {
    const expected = ["health", "read", "write", "stat", "glob", "grep", "exec", "shell", "batch"];
    expect(STUB_METHODS).toHaveLength(9);
    expect(new Set(STUB_METHODS).size).toBe(9);
    expect([...STUB_METHODS].sort()).toEqual([...expected].sort());
  });
});

describe("stub envelope and frame (AC-12.2)", () => {
  it("names the literal camelCase envelope keys", () => {
    expect(Object.keys(stubEnvelopeSchema.shape).sort()).toEqual(
      ["maxBytes", "maxMs", "cwd", "envAllowlist", "capability"].sort(),
    );
  });

  it("builds every params schema from the envelope, so the keys hold by construction", () => {
    const envelopeKeys = Object.keys(stubEnvelopeSchema.shape);
    const paramsSchemas = {
      health: healthParamsSchema,
      read: readParamsSchema,
      write: writeParamsSchema,
      stat: statParamsSchema,
      glob: globParamsSchema,
      grep: grepParamsSchema,
      exec: execParamsSchema,
      shell: shellParamsSchema,
      batch: batchParamsSchema,
    } as const;
    expect(Object.keys(paramsSchemas)).toHaveLength(9);
    for (const [method, schema] of Object.entries(paramsSchemas)) {
      const keys = Object.keys(schema.shape);
      for (const key of envelopeKeys) {
        expect(keys, `${method} params carry envelope key ${key}`).toContain(key);
      }
    }
  });
});

const envelope = {
  maxBytes: 1024,
  maxMs: 1000,
  cwd: "/tmp",
  envAllowlist: [] as string[],
  capability: { risk_class: "read" as const },
};

function paramsFor(
  method: StubMethod,
):
  | HealthParams
  | ReadParams
  | WriteParams
  | StatParams
  | GlobParams
  | GrepParams
  | ExecParams
  | ShellParams
  | BatchParams {
  switch (method) {
    case "health":
      return { ...envelope };
    case "read":
      return { ...envelope, path: "a.txt" };
    case "write":
      return { ...envelope, path: "a.txt", contents: "hi" };
    case "stat":
      return { ...envelope, path: "a.txt" };
    case "glob":
      return { ...envelope, pattern: "src/**/*.ts" };
    case "grep":
      return { ...envelope, pattern: "foo" };
    case "exec":
      return { ...envelope, program: "/bin/echo", argv: ["hi"] };
    case "shell":
      return { ...envelope, command: "echo hi", plannedSubcommands: [] };
    case "batch":
      return { ...envelope, ops: [] };
  }
}

/** Conformance double: typechecks the interface, implements nothing (AC-12.5). */
const conformanceDouble = {
  health: async (_params: HealthParams, _signal: AbortSignal) => ({
    status: "ok",
    bytes: 0,
    truncated: false,
    elapsedMs: 0,
    version: "0.1.0",
    protocolVersion: 1,
    sandboxProfile: null,
    enforcement: "unknown",
  }),
  read: async function* (_params: ReadParams, _signal: AbortSignal) {
    yield { type: "chunk", bytes: new Uint8Array([104, 105]) };
    yield { type: "end", frame: { status: "ok", bytes: 2, truncated: false, elapsedMs: 0 } };
  },
  write: async (_params: WriteParams, _signal: AbortSignal) => ({
    status: "ok",
    bytes: 2,
    truncated: false,
    elapsedMs: 0,
    path: "a.txt",
    bytesWritten: 2,
  }),
  stat: async (_params: StatParams, _signal: AbortSignal) => ({
    status: "ok",
    bytes: 0,
    truncated: false,
    elapsedMs: 0,
    entry: null,
  }),
  glob: async (_params: GlobParams, _signal: AbortSignal) => ({
    status: "ok",
    bytes: 0,
    truncated: false,
    elapsedMs: 0,
    paths: [],
  }),
  grep: async function* (_params: GrepParams, _signal: AbortSignal) {
    yield { type: "end", frame: { status: "ok", bytes: 0, truncated: false, elapsedMs: 0 } };
  },
  exec: async function* (_params: ExecParams, _signal: AbortSignal) {
    yield { type: "stdout", bytes: new Uint8Array([104, 105]) };
    yield {
      type: "end",
      frame: { status: "ok", bytes: 2, truncated: false, elapsedMs: 0, exitCode: 0, signal: null },
    };
  },
  shell: async function* (_params: ShellParams, _signal: AbortSignal) {
    yield {
      type: "end",
      frame: { status: "ok", bytes: 0, truncated: false, elapsedMs: 0, exitCode: 0, signal: null },
    };
  },
  batch: async (_params: BatchParams, _signal: AbortSignal) => ({
    status: "ok",
    bytes: 0,
    truncated: false,
    elapsedMs: 0,
    results: [],
  }),
} satisfies StubClient;

describe("stub streaming shape (AC-12.3)", () => {
  it("returns async iterables for read, exec, shell and grep", () => {
    const signal = new AbortController().signal;
    for (const method of ["read", "exec", "shell", "grep"] as const) {
      const stream = conformanceDouble[method](
        paramsFor(method) as never,
        signal,
      ) as unknown as AsyncIterable<unknown>;
      expect(typeof stream[Symbol.asyncIterator]).toBe("function");
    }
  });

  it("resolves each stream to a terminal { type: end, frame } event", async () => {
    const signal = new AbortController().signal;
    for (const method of ["read", "exec", "shell", "grep"] as const) {
      const stream = conformanceDouble[method](
        paramsFor(method) as never,
        signal,
      ) as unknown as AsyncIterable<Record<string, unknown>>;
      const events: Record<string, unknown>[] = [];
      for await (const event of stream) events.push(event);
      expect(events.length).toBeGreaterThan(0);
      const last = events[events.length - 1];
      expect(last?.["type"]).toBe("end");
      expect(last?.["frame"]).toMatchObject({ status: "ok" });
    }
  });
});
