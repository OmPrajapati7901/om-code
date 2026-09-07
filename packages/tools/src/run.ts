/**
 * The AC-16.6 sequencer (LRN-16).
 *
 * `runTool` awaits `plan()`, then awaits `record(...)`, and only then
 * touches `execute()` — the same append-before-effect ordering LRN-10's
 * turn loop already uses. A `plan()` rejection means `execute()` never runs.
 */

import type { ToolCall } from "@om-code/protocol";
import type { ToolIo } from "./ports.js";
import type { Tool, ToolContext, ToolEvent } from "./tool.js";

/**
 * The narrowest possible journal seam: a callback, not a port object, so
 * tools takes no dependency on kernel or storage. The CLI wires this to a
 * real `JournalWriter`; LRN-18's loop reaches it the same way.
 */
export type ToolCallRecorder = (call: ToolCall) => Promise<void>;

export async function* runTool(
  tool: Tool,
  input: unknown,
  io: ToolIo,
  ctx: ToolContext,
  deps: { readonly record: ToolCallRecorder; readonly callId: string },
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
  yield* tool.execute(input, io, ctx);
}
