import type { CompleteToolCall, ErrorEntry, ModelResponse, Usage } from "@om-code/protocol";
import type { SessionView } from "@om-code/session";
import type { AssembledPrompt } from "./prompt.js";

export type TurnState =
  | { readonly phase: "idle"; readonly session: SessionView }
  | { readonly phase: "building_context"; readonly turnId: string; readonly text: string }
  | {
      readonly phase: "waiting_for_model";
      readonly turnId: string;
      readonly prompt: AssembledPrompt;
    }
  | {
      readonly phase: "streaming_model";
      readonly turnId: string;
      readonly prompt: AssembledPrompt;
      readonly text: string;
      readonly thinking: string;
    }
  | { readonly phase: "yield_candidate"; readonly turnId: string; readonly response: ModelResponse }
  | {
      readonly phase: "executing_tools";
      readonly turnId: string;
      readonly response: ModelResponse;
      readonly calls: readonly CompleteToolCall[];
    }
  | {
      readonly phase: "completed";
      readonly turnId: string;
      readonly response: ModelResponse;
      readonly usage: Usage;
    }
  | { readonly phase: "failed"; readonly turnId: string; readonly error: ErrorEntry }
  | { readonly phase: "limited"; readonly turnId: string; readonly error: ErrorEntry }
  | {
      readonly phase: "interrupted";
      readonly turnId: string;
      readonly partial: ModelResponse | undefined;
    };

export type TurnPhase = TurnState["phase"];

type Successors = {
  idle: "building_context";
  building_context: "waiting_for_model" | "limited" | "failed";
  waiting_for_model: "streaming_model" | "failed" | "interrupted";
  streaming_model: "yield_candidate" | "executing_tools" | "limited" | "failed" | "interrupted";
  executing_tools: "building_context" | "limited" | "failed" | "interrupted";
  yield_candidate: "completed";
  completed: never;
  failed: never;
  limited: never;
  interrupted: never;
};

export type StateOf<P extends TurnPhase> = Extract<TurnState, { phase: P }>;
export type Transition<P extends TurnPhase, N extends Successors[P] = Successors[P]> = (
  state: StateOf<P>,
) => StateOf<N>;
