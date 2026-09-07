/**
 * The frozen tool shape (LRN-16, blueprint §8.3, LR-FR-015, LR-FR-020).
 *
 * `descriptor()` states the contract, `plan()` declares the capability the
 * input needs (journaled before every execution, AC-16.6), and `execute()`
 * receives the stub port and has no other I/O capability in scope (AC-16.2).
 * `plan()` returns exactly what LRN-21a's policy engine consumes: the
 * protocol `CapabilityRequest`, unchanged (X-4).
 */

import type { CapabilityRequest, ModelTool, ToolStatus } from "@om-code/protocol";
import type { ToolIo } from "./ports.js";
import type { ToolName } from "./roster.js";

export type { ToolIo };

export type ToolContext = {
  readonly cwd: string;
  readonly envAllowlist: readonly string[];
  /** Supplied by the caller; LRN-19 owns these numbers. No tool truncates. */
  readonly budget: { readonly maxBytes: number; readonly maxMs: number };
  readonly signal: AbortSignal;
};

export type ToolDescriptor = {
  readonly name: ToolName;
  readonly version: string;
  readonly description: string;
  readonly risk_class: CapabilityRequest["risk_class"];
  /** `z.toJSONSchema(inputSchema)` — the one source (AC-16.5, X-12). */
  readonly parameters: Readonly<Record<string, unknown>>;
};

/**
 * `ToolEvent` mirrors the stub's `{...} | {type: "end", frame}` idiom and
 * terminates with exactly the fields `toolResultV1` needs, so LRN-18 journals
 * the result without a translation layer.
 */
export type ToolEvent =
  | { type: "output"; text: string }
  | {
      type: "end";
      result: {
        status: ToolStatus;
        preview: string;
        bytes: number;
        truncated: boolean;
        blob_ref?: string;
      };
    };

export interface Tool {
  descriptor(): ToolDescriptor;
  plan(input: unknown, ctx: ToolContext): Promise<CapabilityRequest>;
  execute(input: unknown, io: ToolIo, ctx: ToolContext): AsyncIterable<ToolEvent>;
}

/** The one call LRN-17 needs to reach `assemblePrompt`. */
export function toModelTool(descriptor: ToolDescriptor): ModelTool {
  return {
    name: descriptor.name,
    description: descriptor.description,
    parameters: { ...descriptor.parameters },
  };
}
