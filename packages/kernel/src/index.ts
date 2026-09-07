/**
 * Public surface of @om-code/kernel (LRN-09 and LRN-10).
 */

export { IDENTITY, RULES, type Rule } from "./identity.js";
export { runTurn, type TurnEvent, type TurnInput } from "./loop.js";
export type { JournalSink } from "./ports.js";
export {
  type AssembledPrompt,
  assemblePrompt,
  type Environment,
  type InstructionFile,
  PromptError,
  type PromptErrorKind,
  type PromptInput,
} from "./prompt.js";
export type { StateOf, Transition, TurnPhase, TurnState } from "./turn.js";
