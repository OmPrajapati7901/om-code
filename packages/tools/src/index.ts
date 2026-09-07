/**
 * LRN-16: the frozen tool shape, the seven-name roster, and the registry.
 *
 * Depends on `@om-code/protocol` and `zod` only. `execute()` reaches the
 * stub through the structural `ToolIo` port, which `StubClient` satisfies —
 * tools never imports another adapter.
 */
export { isToolError, ToolError, type ToolErrorKind } from "./errors.js";
export type { ToolIo } from "./ports.js";
export { createRegistry, TOOL_ROSTER, type ToolName, type ToolRegistry } from "./registry.js";
export type { ToolCallRecorder } from "./run.js";
export { runTool } from "./run.js";
export {
  type Tool,
  type ToolContext,
  type ToolDescriptor,
  type ToolEvent,
  toModelTool,
} from "./tool.js";
export {
  createGlobTool,
  createGrepTool,
  createReadTool,
  globInputSchema,
  grepInputSchema,
  READ_REFUSAL_PREFIX,
  type ReadRefusal,
  readInputSchema,
  readOnlyTools,
} from "./tools/index.js";
