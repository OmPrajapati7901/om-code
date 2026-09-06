/**
 * Public surface of @om-code/kernel (LRN-09).
 *
 * Prompt assembly today; LRN-10 adds the turn loop to this same package.
 */

export { IDENTITY, RULES, type Rule } from "./identity.js";
export {
  type AssembledPrompt,
  assemblePrompt,
  type Environment,
  type InstructionFile,
  PromptError,
  type PromptErrorKind,
  type PromptInput,
} from "./prompt.js";
