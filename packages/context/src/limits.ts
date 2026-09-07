/**
 * Every bound lives here (LRN-19, AC-19.5/19.6, LR-FR-023, LR-NFR-003).
 *
 * Two byte budgets form a hierarchy, and the reason both numbers belong in
 * this one module: the stub's `maxBytes` is the transport cap the driver
 * enforces per frame; `DEFAULT_RESULT_BYTES` is the much smaller context cap
 * this package enforces above it. Truncation above the transport layer is
 * what spills to the blob store.
 */

export const DEFAULT_TOOL_BUDGET = {
  /** Transport cap per stub call — must stay well above the context cap. */
  maxBytes: 1024 * 1024,
  maxMs: 30_000,
} as const;

export type ToolBudget = {
  readonly maxBytes: number;
  readonly maxMs: number;
};

/** Context cap: no tool result preview entering the prompt exceeds this. */
export const DEFAULT_RESULT_BYTES = 64 * 1024;

/** Wall-clock cap for one `om run` invocation unless configured otherwise. */
export const DEFAULT_MAX_WALL_CLOCK_MS = 10 * 60 * 1000;
