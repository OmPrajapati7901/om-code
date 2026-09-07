/**
 * The seven-name roster (LRN-16, LR-FR-020).
 *
 * A leaf inside this package: `tool.ts` needs `ToolName` for the descriptor
 * and `registry.ts` needs both, so defining them anywhere else would close a
 * cycle under `no-circular` — the same reason `cli` keeps its seams in
 * `types.ts`. Exactly seven, forever: adding an eighth is a deliberate act.
 */
export const TOOL_ROSTER = ["read", "grep", "glob", "edit", "write", "bash", "todo"] as const;

export type ToolName = (typeof TOOL_ROSTER)[number];
