/**
 * LRN-10: append-then-act turn loop, without tool execution.
 *
 * | Transition | Journaled first | Effect authorized |
 * | --- | --- | --- |
 * | idle → building_context | user_message | assemble the prompt from the session |
 * | building_context → waiting_for_model | prompt | call provider.stream |
 * | streaming_model → yield_candidate | assistant_message v2 (complete) | surface a final answer |
 * | yield_candidate → completed | turn_end | mark the session idle |
 * | → failed | error, partial assistant if present, turn_end | report failure |
 * | → interrupted | partial assistant if present, turn_end | return control to the user |
 *
 * Text and thinking deltas are intentionally provisional and may reach the
 * caller before the terminal assistant record commits. The durable record is
 * the authority after interruption or restart.
 */
import {
  type ErrorEntry,
  isProviderError,
  type ModelProvider,
  type ModelResponse,
  type ModelTool,
  type ProviderError,
} from "@om-code/protocol";
import type { SessionView } from "@om-code/session";
import type { JournalSink } from "./ports.js";
import { assemblePrompt, type Environment, type InstructionFile, PromptError } from "./prompt.js";
import type { StateOf, Transition, TurnState } from "./turn.js";

export type TurnInput = {
  readonly session: SessionView;
  readonly text: string;
  readonly provider: ModelProvider;
  readonly journal: JournalSink;
  readonly newTurnId: () => string;
  readonly signal: AbortSignal;
  readonly model: string;
  readonly environment: Environment;
  readonly instructions: readonly InstructionFile[];
  readonly tools: readonly ModelTool[];
};

export type TurnEvent =
  | { readonly type: "state"; readonly state: TurnState }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "thinking_delta"; readonly text: string }
  | {
      readonly type: "turn_end";
      readonly state: StateOf<"completed" | "failed" | "interrupted">;
    };

class JournalCommitError {
  readonly original: unknown;
  constructor(original: unknown) {
    this.original = original;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localReason(error: unknown): string {
  return error instanceof PromptError ? error.kind : "unexpected";
}

function isRetryable(error: ProviderError): boolean {
  return error.kind === "http" && error.status !== undefined
    ? error.status === 429 || error.status >= 500
    : false;
}

function sessionWithUserMessage(session: SessionView, text: string): SessionView {
  return {
    ...session,
    meta: session.meta === undefined ? undefined : { ...session.meta, status: "active" },
    conversation: [...session.conversation, { kind: "user_message", schemaVersion: 1, text }],
  };
}

export async function* runTurn(input: TurnInput): AsyncIterable<TurnEvent> {
  const turnId = input.newTurnId();
  const idle: StateOf<"idle"> = { phase: "idle", session: input.session };
  const append = async (
    entry: Parameters<JournalSink["append"]>[0],
    context: Parameters<JournalSink["append"]>[1],
  ) => {
    try {
      return await input.journal.append(entry, context);
    } catch (error) {
      throw new JournalCommitError(error);
    }
  };

  const begin: Transition<"idle", "building_context"> = () => ({
    phase: "building_context",
    turnId,
    text: input.text,
  });

  await append(
    { kind: "user_message", schemaVersion: 1, text: input.text },
    { by: "user", turn_id: turnId },
  );
  const building = begin(idle);
  yield { type: "state", state: building };

  let current: StateOf<"building_context" | "waiting_for_model" | "streaming_model"> = building;
  try {
    if (input.session.meta === undefined) {
      throw new Error("session metadata is required; append session_start before running a turn");
    }
    const prompt = assemblePrompt({
      session: sessionWithUserMessage(input.session, input.text),
      model: input.model,
      environment: input.environment,
      instructions: input.instructions,
      tools: input.tools,
    });
    const waitForModel: Transition<"building_context", "waiting_for_model"> = () => ({
      phase: "waiting_for_model",
      turnId,
      prompt,
    });
    await append(
      { kind: "prompt", schemaVersion: 1, instructions: [...prompt.instructions] },
      { by: "system", turn_id: turnId },
    );
    const waiting = waitForModel(building);
    current = waiting;
    yield { type: "state", state: waiting };

    const stream = input.provider.stream(prompt.request, input.signal);
    const startStreaming: Transition<"waiting_for_model", "streaming_model"> = () => ({
      phase: "streaming_model",
      turnId,
      prompt,
      text: "",
      thinking: "",
    });
    let streaming = startStreaming(waiting);
    current = streaming;
    yield { type: "state", state: streaming };

    let response: ModelResponse | undefined;
    for await (const event of stream) {
      if (event.type === "text_delta") {
        streaming = { ...streaming, text: streaming.text + event.text };
        current = streaming;
        yield { type: "text_delta", text: event.text };
      } else if (event.type === "thinking_delta") {
        streaming = { ...streaming, thinking: streaming.thinking + event.text };
        current = streaming;
        yield { type: "thinking_delta", text: event.text };
      } else if (event.type === "message_stop") {
        response = event.response;
      }
    }
    if (response === undefined) {
      throw new Error("provider stream ended without message_stop");
    }

    const offerYield: Transition<"streaming_model", "yield_candidate"> = () => ({
      phase: "yield_candidate",
      turnId,
      response,
    });
    await append(
      { kind: "assistant_message", schemaVersion: 2, ...response },
      { by: "model", turn_id: turnId },
    );
    const candidate = offerYield(streaming);
    yield { type: "state", state: candidate };

    const complete: Transition<"yield_candidate", "completed"> = () => ({
      phase: "completed",
      turnId,
      response,
      usage: response.usage,
    });
    await append(
      { kind: "turn_end", schemaVersion: 1, usage: response.usage },
      { by: "system", turn_id: turnId },
    );
    const completed = complete(candidate);
    yield { type: "state", state: completed };
    yield { type: "turn_end", state: completed };
  } catch (caught) {
    if (caught instanceof JournalCommitError) throw caught.original;
    const providerError = isProviderError(caught) ? caught : undefined;
    const partial = providerError?.partial;

    if (providerError?.kind === "aborted") {
      if (partial !== undefined) {
        await append(
          { kind: "assistant_message", schemaVersion: 2, ...partial },
          { by: "model", turn_id: turnId },
        );
      }
      await append(
        { kind: "turn_end", schemaVersion: 1, usage: { kind: "unknown" } },
        { by: "system", turn_id: turnId },
      );
      if (current.phase === "building_context") throw caught;
      const interrupt: Transition<"waiting_for_model" | "streaming_model", "interrupted"> = () => ({
        phase: "interrupted",
        turnId,
        partial,
      });
      const interrupted = interrupt(current);
      yield { type: "state", state: interrupted };
      yield { type: "turn_end", state: interrupted };
      return;
    }

    const error: ErrorEntry = providerError
      ? {
          kind: "error",
          schemaVersion: 1,
          source: "provider",
          reason: providerError.kind,
          message: providerError.message,
          ...(providerError.status === undefined ? {} : { status: providerError.status }),
          retryable: isRetryable(providerError),
        }
      : {
          kind: "error",
          schemaVersion: 1,
          source: "local",
          reason: localReason(caught),
          message: messageOf(caught),
          retryable: false,
        };
    await append(error, { by: "system", turn_id: turnId });
    if (partial !== undefined) {
      await append(
        { kind: "assistant_message", schemaVersion: 2, ...partial },
        { by: "model", turn_id: turnId },
      );
    }
    await append(
      { kind: "turn_end", schemaVersion: 1, usage: { kind: "unknown" } },
      { by: "system", turn_id: turnId },
    );
    const fail: Transition<
      "building_context" | "waiting_for_model" | "streaming_model",
      "failed"
    > = () => ({ phase: "failed", turnId, error });
    const failed = fail(current);
    yield { type: "state", state: failed };
    yield { type: "turn_end", state: failed };
  }
}
