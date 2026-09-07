/**
 * Trivial fake tools for the interface and registry tests. Real tools arrive
 * in LRN-17/26/27/28; these exist only to exercise the shape.
 */
import type {
  CapabilityRequest,
  GlobResult,
  GrepEvent,
  ReadEvent,
  ReadFrame,
} from "@om-code/protocol";
import type {
  Tool,
  ToolContext,
  ToolDescriptor,
  ToolEvent,
  ToolIo,
  ToolName,
} from "../src/index.js";

export type { ToolIo };

export function fakeDescriptor(name: ToolName): ToolDescriptor {
  return {
    name,
    version: "0.1.0",
    description: `fake ${name} tool`,
    risk_class: "read",
    parameters: {},
  };
}

export function fakeCapability(): CapabilityRequest {
  return { risk_class: "read" };
}

export async function* fakeEnd(): AsyncIterable<ToolEvent> {
  yield {
    type: "end",
    result: { status: "ok", preview: "", bytes: 0, truncated: false },
  };
}

export function fakeTool(name: ToolName): Tool {
  return {
    descriptor: () => fakeDescriptor(name),
    plan: async (_input: unknown, _ctx: ToolContext) => fakeCapability(),
    execute: (_input: unknown, _io: ToolIo, _ctx: ToolContext) => fakeEnd(),
  };
}

export function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: "/workspace",
    envAllowlist: [],
    budget: { maxBytes: 4096, maxMs: 5000 },
    signal: new AbortController().signal,
    ...overrides,
  };
}

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

export function readEvents(
  chunks: readonly (string | Uint8Array)[],
  frame: Partial<ReadFrame> = {},
): AsyncIterable<ReadEvent> {
  return (async function* () {
    for (const chunk of chunks) {
      yield {
        type: "chunk" as const,
        bytes: typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
      };
    }
    yield {
      type: "end" as const,
      frame: {
        status: "ok" as const,
        bytes: chunks.reduce(
          (total, chunk) =>
            total +
            (typeof chunk === "string" ? new TextEncoder().encode(chunk).length : chunk.length),
          0,
        ),
        truncated: false,
        elapsedMs: 1,
        totalLines: 0,
        ...frame,
      },
    };
  })();
}

export function grepEvents(events: readonly GrepEvent[]): AsyncIterable<GrepEvent> {
  return (async function* () {
    yield* events;
  })();
}

export function fakeIo(overrides: Partial<ToolIo> = {}): ToolIo {
  const unused = (): never => {
    throw new Error("unexpected ToolIo method");
  };
  return {
    read: () => unused(),
    write: () => unused(),
    stat: () => unused(),
    glob: () => unused(),
    grep: () => unused(),
    exec: () => unused(),
    shell: () => unused(),
    ...overrides,
  };
}

export function globResult(overrides: Partial<GlobResult> = {}): GlobResult {
  return {
    status: "ok",
    bytes: 0,
    truncated: false,
    elapsedMs: 1,
    paths: [],
    ...overrides,
  };
}

export function throwingIo(error: unknown): ToolIo {
  const fail = (): never => {
    throw error;
  };
  return fakeIo({
    read: fail,
    glob: fail,
    grep: fail,
  });
}
