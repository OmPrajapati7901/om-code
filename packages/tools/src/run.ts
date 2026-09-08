/**
 * The AC-16.6 sequencer (LRN-16), extended with the policy gate (LRN-21d).
 *
 * `runTool` awaits `plan()`, then awaits `record(...)`, then awaits the
 * optional `authorize(...)` verdict — and only then touches `execute()`.
 * The verdict is deliberately narrow (`allow` or not): reasons, tiers and
 * rule ids stay with the caller that journals them, so this package keeps
 * no policy surface beyond the seam (AC-16.2, AC-21.1). A denied call yields
 * a terminal `denied` end event without `execute()` ever running.
 */

import type { CapabilityRequest, ToolCall } from "@om-code/protocol";
import type { ToolIo } from "./ports.js";
import type { Tool, ToolContext, ToolEvent } from "./tool.js";

/**
 * The narrowest possible journal seam: a callback, not a port object, so
 * tools takes no dependency on kernel or storage. The CLI wires this to a
 * real `JournalWriter`; LRN-18's loop reaches it the same way.
 */
export type ToolCallRecorder = (call: ToolCall) => Promise<void>;

/** Policy verdict: `true` executes, `false` ends `denied` without executing. */
export type AuthorizeHook = (capability: CapabilityRequest) => Promise<boolean>;

export async function* runTool(
  tool: Tool,
  input: unknown,
  io: ToolIo,
  ctx: ToolContext,
  deps: {
    readonly record: ToolCallRecorder;
    readonly callId: string;
    readonly authorize?: AuthorizeHook;
  },
): AsyncIterable<ToolEvent> {
  const capability = await tool.plan(input, ctx);
  await deps.record({
    kind: "tool_call",
    schemaVersion: 1,
    call_id: deps.callId,
    tool: tool.descriptor().name,
    input,
    capability,
  });
  if (deps.authorize !== undefined && !(await deps.authorize(capability))) {
    yield {
      type: "end",
      result: { status: "denied", preview: "", bytes: 0, truncated: false },
    };
    return;
  }
  yield* tool.execute(input, io, ctx);
}
