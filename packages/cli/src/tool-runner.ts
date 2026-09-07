/**
 * LRN-18: the CLI adapter satisfying kernel's `ToolRunner`.
 *
 * Delegates to `runTool` so AC-16.6's plan() → record → execute() sequencing
 * is preserved rather than reimplemented. Every failure returns a
 * failed-status outcome and never throws (AC-18.4), so one bad call cannot
 * abort the turn.
 */

import type { ToolRunner } from "@om-code/kernel";
import type { CompleteToolCall, ToolCall } from "@om-code/protocol";
import { runTool, type ToolIo, type ToolRegistry } from "@om-code/tools";

export type ToolRunnerDeps = {
  readonly registry: ToolRegistry;
  readonly io: ToolIo;
  readonly cwd: string;
  readonly envAllowlist: readonly string[];
  readonly budget: { readonly maxBytes: number; readonly maxMs: number };
};

function failedOutcome(preview: string): {
  readonly status: "error";
  readonly preview: string;
  readonly bytes: number;
  readonly truncated: boolean;
} {
  return {
    status: "error",
    preview,
    bytes: Buffer.byteLength(preview, "utf8"),
    truncated: false,
  };
}

export function createToolRunner(deps: ToolRunnerDeps): ToolRunner {
  return {
    async run(
      call: CompleteToolCall,
      runnerDeps: {
        readonly record: (call: ToolCall) => Promise<void>;
        readonly signal: AbortSignal;
      },
    ) {
      const tool = deps.registry.get(call.name);
      if (tool === undefined) {
        return failedOutcome(`unknown tool "${call.name}" for call ${call.call_id}`);
      }
      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(call.arguments_raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return failedOutcome(
          `invalid JSON arguments for tool "${call.name}" (${call.call_id}): ${detail}; raw: ${call.arguments_raw}`,
        );
      }
      const ctx = {
        cwd: deps.cwd,
        envAllowlist: deps.envAllowlist,
        budget: deps.budget,
        signal: runnerDeps.signal,
      };
      try {
        let terminal:
          | {
              status: "error" | "ok" | "denied" | "cancelled" | "timeout" | "unknown";
              preview: string;
              bytes: number;
              truncated: boolean;
              blob_ref?: string;
            }
          | undefined;
        for await (const event of runTool(tool, parsedInput, deps.io, ctx, {
          record: runnerDeps.record,
          callId: call.call_id,
        })) {
          // Each tool yields its preview as `output` and then again inside
          // `end` — discard the former and journal the latter verbatim.
          if (event.type === "end") terminal = event.result;
        }
        if (terminal === undefined) {
          return failedOutcome(
            `tool "${call.name}" violated the event protocol: generator ended without an end event (${call.call_id})`,
          );
        }
        return terminal;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failedOutcome(`tool "${call.name}" failed (${call.call_id}): ${message}`);
      }
    },
  };
}
