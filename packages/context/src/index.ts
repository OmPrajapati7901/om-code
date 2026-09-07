/**
 * Public surface of @om-code/context (LRN-19).
 *
 * Central runtime bounding: every number, the truncation bounder with its
 * blob spill, cost arithmetic, and the run budget. Depends on
 * `@om-code/protocol` only.
 */

export {
  type Bounder,
  type BoundInput,
  type BoundOptions,
  type BoundOutcome,
  createBounder,
  cutAtCharBoundary,
} from "./bound.js";
export {
  type BudgetTrip,
  createRunBudget,
  type RunBudget,
} from "./budget.js";
export { type ModelPricing, usdFor } from "./cost.js";
export {
  DEFAULT_MAX_WALL_CLOCK_MS,
  DEFAULT_RESULT_BYTES,
  DEFAULT_TOOL_BUDGET,
  type ToolBudget,
} from "./limits.js";
export type { BlobStore } from "./ports.js";
