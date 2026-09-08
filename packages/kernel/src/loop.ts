/**
 * LRN-10: append-then-act turn loop, extended by LRN-18 into a multi-tool loop.
 *
 * | Transition | Journaled first | Effect authorized |
 * | --- | --- | --- |
 * | idle → building_context | user_message | assemble the prompt from the session |
 * | building_context → waiting_for_model | prompt | call provider.stream |
 * | streaming_model → yield_candidate | assistant_message v2 (complete) | surface a final answer |
 * | streaming_model → executing_tools | assistant_message v2 (complete, with calls) | run the requested tools |
 * | executing_tools → building_context | tool_call + tool_result per call | re-assemble with results |
 * | yield_candidate → completed | turn_end | mark the session idle |
 * | → failed | error, partial assistant if present, turn_end | report failure |
 * | → interrupted | partial assistant if present, turn_end | return control to the user |
 *
 * Text and thinking deltas are intentionally provisional and may reach the
 * caller before the terminal assistant record commits. The durable record is
 * the authority after interruption or restart.
 *
 * One turn_id spans every iteration; exactly one turn_end closes the turn.
 * Tool calls within one iteration run concurrently (Promise.all); the
 * JournalWriter serializes appends, and `record` is awaited before execution
 * (AC-16.6), so each call's tool_call precedes its own tool_result (AC-18.3).
 */
import {
  type CompleteToolCall,
  type ErrorEntry,
  isProviderError,
  type ModelProvider,
  type ModelResponse,
  type ModelTool,
  type ProviderError,
  type ToolCall,
} from "@om-code/protocol";
import type { SessionView } from "@om-code/session";
import type {
  BudgetTrip,
  BudgetTripReason,
  JournalSink,
  ToolOutcome,
  ToolRunner,
  TurnBudget,
} from "./ports.js";
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
  /** Absent = no tool execution; M1 paths and `om show` stay honest. */
  readonly toolRunner?: ToolRunner | undefined;
  /** Absent = unbounded; M1's tests stay honest. */
  readonly budget?: TurnBudget | undefined;
};

export type TurnEvent =
  | { readonly type: "state"; readonly state: TurnState }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "thinking_delta"; readonly text: string }
  | { readonly type: "tool_call"; readonly call: CompleteToolCall }
  | { readonly type: "tool_result"; readonly call_id: string; readonly result: ToolOutcome }
  | {
      readonly type: "turn_end";
      readonly state: StateOf<"completed" | "failed" | "interrupted" | "limited">;
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

/**
 * Exit-code mapping for budget trips: exhausted bounds are `limited`
 * (exit 3); `max-cost-unknown-usage` is a startup-correction failure
 * (exit 1), since cost was never knowable rather than exceeded.
 */
function isLimitReason(reason: BudgetTripReason): boolean {
  return reason === "max-turns" || reason === "wall-clock" || reason === "max-cost";
}

function tripError(trip: BudgetTrip): ErrorEntry {
  return {
    kind: "error",
    schemaVersion: 1,
    source: "local",
    reason: trip.reason,
    message: trip.message,
    retryable: false,
  };
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
    toolCalls: [...session.toolCalls],
    toolResults: [...session.toolResults],
    pendingCallIds: [...session.pendingCallIds],
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
  let building = begin(idle);
  yield { type: "state", state: building };

  // In-memory accumulator mirroring what a journal re-read would produce, so
  // the next assemblePrompt sees tool history without kernel reading the
  // journal (which kernel must not do).
  let view = sessionWithUserMessage(input.session, input.text);
  const pending = new Set<string>(view.pendingCallIds);

  let current: StateOf<
    "building_context" | "waiting_for_model" | "streaming_model" | "executing_tools"
  > = building;
  try {
    if (input.session.meta === undefined) {
      throw new Error("session metadata is required; append session_start before running a turn");
    }
    for (;;) {
      const preTrip = input.budget?.check();
      if (preTrip !== undefined) {
        const error = tripError(preTrip);
        await append(error, { by: "system", turn_id: turnId });
        await append(
          { kind: "turn_end", schemaVersion: 1, usage: { kind: "unknown" } },
          { by: "system", turn_id: turnId },
        );
        if (isLimitReason(preTrip.reason)) {
          const limit: Transition<"building_context", "limited"> = () => ({
            phase: "limited",
            turnId,
            error,
          });
          const limited = limit(building);
          yield { type: "state", state: limited };
          yield { type: "turn_end", state: limited };
        } else {
          const fail: Transition<"building_context", "failed"> = () => ({
            phase: "failed",
            turnId,
            error,
          });
          const failed = fail(building);
          yield { type: "state", state: failed };
          yield { type: "turn_end", state: failed };
        }
        return;
      }
      const prompt = assemblePrompt({
        session: view,
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

      const assistantEntry = { kind: "assistant_message", schemaVersion: 2, ...response } as const;
      await append(assistantEntry, { by: "model", turn_id: turnId });
      view = {
        ...view,
        conversation: [...view.conversation, { ...assistantEntry }],
      };

      // The inference is journaled before the budget verdict: the spend
      // happened, and the journal stays reconstructable (AC-10.3). The trip
      // stops every further inference and tool execution instead.
      const postTrip = input.budget?.recordInference(response.usage);
      if (postTrip !== undefined) {
        const error = tripError(postTrip);
        await append(error, { by: "system", turn_id: turnId });
        await append(
          { kind: "turn_end", schemaVersion: 1, usage: { kind: "unknown" } },
          { by: "system", turn_id: turnId },
        );
        if (isLimitReason(postTrip.reason)) {
          const limit: Transition<"streaming_model", "limited"> = () => ({
            phase: "limited",
            turnId,
            error,
          });
          const limited = limit(streaming);
          yield { type: "state", state: limited };
          yield { type: "turn_end", state: limited };
        } else {
          const fail: Transition<"streaming_model", "failed"> = () => ({
            phase: "failed",
            turnId,
            error,
          });
          const failed = fail(streaming);
          yield { type: "state", state: failed };
          yield { type: "turn_end", state: failed };
        }
        return;
      }

      const calls =
        response.outcome.kind === "complete" ? (response.tool_calls as CompleteToolCall[]) : [];
      const wantsTools = calls.length > 0 && input.toolRunner !== undefined;
      if (!wantsTools) {
        const offerYield: Transition<"streaming_model", "yield_candidate"> = () => ({
          phase: "yield_candidate",
          turnId,
          response,
        });
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
        return;
      }

      const startTools: Transition<"streaming_model", "executing_tools"> = () => ({
        phase: "executing_tools",
        turnId,
        response,
        calls,
      });
      const executing = startTools(streaming);
      current = executing;
      yield { type: "state", state: executing };

      const runner = input.toolRunner;
      if (runner === undefined) throw new Error("tool runner vanished mid-turn");
      for (const call of calls) {
        yield { type: "tool_call", call };
      }
      const outcomes = await Promise.all(
        calls.map(async (call) => {
          const outcome = await runner.run(call, {
            record: async (toolCall: ToolCall) => {
              await append(toolCall, { by: "model", turn_id: turnId });
              view = {
                ...view,
                toolCalls: [...view.toolCalls, { ...toolCall }],
              };
              pending.add(toolCall.call_id);
              view = { ...view, pendingCallIds: [...pending] };
            },
            signal: input.signal,
            recordPermission: async (entry) => {
              await append(entry, { by: "system", turn_id: turnId });
            },
          });
          await append(
            {
              kind: "tool_result",
              schemaVersion: 1,
              call_id: call.call_id,
              status: outcome.status,
              preview: outcome.preview,
              bytes: outcome.bytes,
              truncated: outcome.truncated,
              ...(outcome.blob_ref === undefined ? {} : { blob_ref: outcome.blob_ref }),
            },
            { by: `tool:${call.name}`, turn_id: turnId },
          );
          view = {
            ...view,
            toolResults: [
              ...view.toolResults,
              {
                kind: "tool_result",
                schemaVersion: 1,
                call_id: call.call_id,
                status: outcome.status,
                preview: outcome.preview,
                bytes: outcome.bytes,
                truncated: outcome.truncated,
                ...(outcome.blob_ref === undefined ? {} : { blob_ref: outcome.blob_ref }),
              },
            ],
          };
          pending.delete(call.call_id);
          view = { ...view, pendingCallIds: [...pending] };
          return { call, outcome };
        }),
      );
      for (const { call, outcome } of outcomes) {
        yield { type: "tool_result", call_id: call.call_id, result: outcome };
      }

      const loopBack: Transition<"executing_tools", "building_context"> = () => ({
        phase: "building_context",
        turnId,
        text: input.text,
      });
      building = loopBack(executing);
      current = building;
      yield { type: "state", state: building };
    }
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
      const interrupt: Transition<
        "waiting_for_model" | "streaming_model" | "executing_tools",
        "interrupted"
      > = () => ({
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
      "building_context" | "waiting_for_model" | "streaming_model" | "executing_tools",
      "failed"
    > = () => ({ phase: "failed", turnId, error });
    const failed = fail(current);
    yield { type: "state", state: failed };
    yield { type: "turn_end", state: failed };
  }
}
