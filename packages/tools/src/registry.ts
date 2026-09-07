/**
 * Tool registry (LRN-16, AC-16.3–16.4, LR-FR-020).
 *
 * The roster is a declared constant of seven names, not a count of what
 * happens to be registered — the size test still passes unchanged when
 * LRN-28 registers the seventh tool, and after LRN-17 only three exist.
 */

import { ToolError } from "./errors.js";
import { TOOL_ROSTER, type ToolName } from "./roster.js";
import type { Tool, ToolDescriptor } from "./tool.js";

export { TOOL_ROSTER, type ToolName };

export type ToolRegistry = {
  readonly get: (name: string) => Tool | undefined;
  readonly list: () => readonly Tool[];
  readonly descriptors: () => readonly ToolDescriptor[];
};

export function createRegistry(tools: readonly Tool[]): ToolRegistry {
  const byName = new Map<string, Tool>();
  for (const tool of tools) {
    const name = tool.descriptor().name;
    if (!TOOL_ROSTER.includes(name))
      throw new ToolError("not-in-roster", `tool "${name}" is not in the roster of seven`, {
        name,
      });
    if (byName.has(name))
      throw new ToolError("duplicate-name", `tool "${name}" is already registered`, { name });
    byName.set(name, tool);
  }
  return {
    get: (name: string) => byName.get(name),
    list: () => [...byName.values()],
    descriptors: () => [...byName.values()].map((tool) => tool.descriptor()),
  };
}
