/**
 * Deterministic ModelProvider double (LRN-08, AC-8.1–8.3). Scripts turns at
 * the port level and replays them through the same ResponseProjection the
 * real adapter uses, so fake events/responses share the adapter's shape
 * instead of a second hand-rolled accumulator. No Date.now, Math.random,
 * setTimeout or performance.now anywhere in this file (AC-8.3): output for a
 * given script is byte-identical on every run.
 */
import {
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
  ProviderError,
  type StreamFailureKind,
} from "@om-code/protocol";
import { ResponseProjection } from "./projection.js";

export type FakeDelta =
  | { text: string }
  | { thinking: string }
  | { tool: { index: number; call_id?: string; name?: string; arguments?: string } };

export type FakeUsage = { input_tokens: number; output_tokens: number; total_tokens?: number };

export type FakeAttempt =
  | { kind: "http-error"; status: number; message?: string }
  | {
      kind: "stream";
      id?: string;
      model?: string;
      deltas: readonly FakeDelta[];
      usage?: FakeUsage;
      stop_reason?: string;
      interrupt?: StreamFailureKind;
    };

/** One turn: a single attempt, or a list where every non-final http-error is absorbed. */
export type FakeTurn = FakeAttempt | readonly FakeAttempt[];
export type FakeScript = { turns: readonly FakeTurn[] };

function deltaPayload(delta: FakeDelta): Record<string, unknown> {
  if ("text" in delta) return { content: delta.text };
  if ("thinking" in delta) return { reasoning_content: delta.thinking };
  const { index, call_id, name, arguments: args } = delta.tool;
  return {
    tool_calls: [
      {
        index,
        ...(call_id !== undefined ? { id: call_id } : {}),
        function: {
          ...(name !== undefined ? { name } : {}),
          ...(args !== undefined ? { arguments: args } : {}),
        },
      },
    ],
  };
}

function wireChunk(
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: FakeUsage,
): Record<string, unknown> {
  return {
    id,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage
      ? {
          usage: {
            prompt_tokens: usage.input_tokens,
            completion_tokens: usage.output_tokens,
            ...(usage.total_tokens !== undefined ? { total_tokens: usage.total_tokens } : {}),
          },
        }
      : {}),
  };
}

export class FakeProvider implements ModelProvider {
  private readonly script: FakeScript;
  private turnIndex = 0;
  readonly requests: ModelRequest[] = [];

  constructor(script: FakeScript) {
    this.script = script;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const turn = this.script.turns[this.turnIndex];
    if (turn === undefined) throw new Error("fake script exhausted: no scripted turn remains");
    this.turnIndex++;
    const attempts = Array.isArray(turn) ? turn : [turn];
    const checkAborted = (projection?: ResponseProjection) => {
      if (!signal.aborted) return;
      throw new ProviderError("aborted", "request aborted", projection?.snapshot("aborted"));
    };
    checkAborted();

    for (let attemptIndex = 0; ; attemptIndex++) {
      const attempt = attempts[attemptIndex];
      if (attempt === undefined) throw new Error("fake turn exhausted its scripted attempts");
      if (attempt.kind === "http-error") {
        const isLast = attemptIndex === attempts.length - 1;
        const retriable = attempt.status === 429 || attempt.status >= 500;
        if (!isLast && retriable) continue;
        throw new ProviderError(
          "http",
          attempt.message ?? `HTTP ${attempt.status}`,
          undefined,
          attempt.status,
        );
      }
      const id = attempt.id ?? `fake-${this.turnIndex}-${attemptIndex}`;
      const model = attempt.model ?? request.model;
      const projection = new ResponseProjection();
      for (const delta of attempt.deltas) {
        checkAborted(projection);
        for (const event of projection.accept(wireChunk(id, model, deltaPayload(delta), null)))
          yield event;
      }
      if (attempt.interrupt !== undefined)
        throw new ProviderError(
          attempt.interrupt,
          `fake stream interrupted (${attempt.interrupt})`,
          projection.snapshot(attempt.interrupt),
        );
      checkAborted(projection);
      for (const event of projection.accept(
        wireChunk(id, model, {}, attempt.stop_reason ?? "stop", attempt.usage),
      ))
        yield event;
      yield { type: "message_stop", response: projection.finish() };
      return;
    }
  }
}
