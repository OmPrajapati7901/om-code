/**
 * The twelve journal entry kinds (LRN-05, blueprint §7; `prompt` added in
 * LRN-09 and `error` in LRN-10) plus the version registry (AC-5.4).
 *
 * The four M1 kinds (session_start, user_message, assistant_message,
 * turn_end) are tight. The six M2/M3 kinds carry exactly the fields blueprint
 * §7 names, with undefined sub-types modeled minimally at schemaVersion 1;
 * their owning tasks (LRN-17, 21, 23, 28, 39) extend and bump. `prompt`
 * (LRN-09) is the one M1 addition blueprint §7 did not anticipate.
 *
 * Each entry carries schemaVersion so kinds evolve independently (the
 * architecture doc's R12 mitigation: schemaVersion per node type, adjacent
 * vN → vN+1 migrators). The registry maps kind → version → schema; it is
 * what LRN-06's migrators plug into.
 *
 * Field naming: the journal is a wire format that Rust DTOs will mirror in
 * M4, where snake_case is idiomatic — so entries are snake_case even though
 * LRN-04's config is camelCase (see AGENTS.md).
 */

import { z } from "zod";
import { capabilityRequestSchema } from "./capability.js";
import { textBlockSchema, thinkingBlockSchema } from "./content.js";
import { assistantMessageV2 } from "./model.js";
import { toolStatusSchema, usageSchema } from "./primitives.js";
import { sessionMetaSchema } from "./session.js";

export { textBlockSchema, thinkingBlockSchema } from "./content.js";

/** Content blocks (archived doc's four block types, architecture:611). */
export const toolUseBlockSchema = z
  .object({
    type: z.literal("tool_use"),
    call_id: z.string().min(1),
    tool: z.string().min(1),
    input: z.unknown(),
  })
  .strict();

/**
 * Image blocks carry a blob_ref into ~/.om-code/blobs/sha256/… (blueprint
 * §7:334) rather than inline base64 — journal records stay small and
 * greppable. Strictness rejects inline data by construction.
 */
export const imageBlockSchema = z
  .object({
    type: z.literal("image"),
    media_type: z.string().min(1),
    blob_ref: z.string().min(1),
  })
  .strict();

export const blockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  thinkingBlockSchema,
  toolUseBlockSchema,
  imageBlockSchema,
]);

export type Block = z.infer<typeof blockSchema>;

/**
 * FileSnapshot (blueprint §7:319, minimal). LRN-23 owns checkpoints and will
 * extend it.
 */
export const fileSnapshotSchema = z
  .object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "a 64-char lowercase hex sha256"),
    blob_ref: z.string().min(1).optional(),
    mode: z.number().int().nonnegative().optional(),
  })
  .strict();

export type FileSnapshot = z.infer<typeof fileSnapshotSchema>;

/** StructuredSummary (blueprint §7:339-340): goal typed, the rest string[]. */
export const structuredSummarySchema = z
  .object({
    goal: z.string(),
    decisions: z.array(z.string()),
    constraints: z.array(z.string()),
    changed_files: z.array(z.string()),
    tests: z.array(z.string()),
    failed_attempts: z.array(z.string()),
    approved_permissions: z.array(z.string()),
    open_questions: z.array(z.string()),
    next_steps: z.array(z.string()),
  })
  .strict();

export type StructuredSummary = z.infer<typeof structuredSummarySchema>;

export const sessionStartV1 = z
  .object({
    kind: z.literal("session_start"),
    schemaVersion: z.literal(1),
    meta: sessionMetaSchema,
  })
  .strict();

export const userMessageV1 = z
  .object({
    kind: z.literal("user_message"),
    schemaVersion: z.literal(1),
    text: z.string(),
  })
  .strict();

export const assistantMessageV1 = z
  .object({
    kind: z.literal("assistant_message"),
    schemaVersion: z.literal(1),
    content: z.array(blockSchema),
    usage: usageSchema,
    stop_reason: z.string().optional(),
  })
  .strict();

/**
 * tool_call (blueprint §7:314 spreads an undefined ToolCall type).
 * Learning-scope subset: the archived doc's 14-field node models subagents
 * and jobs, both cut from this release.
 */
export const toolCallV1 = z
  .object({
    kind: z.literal("tool_call"),
    schemaVersion: z.literal(1),
    call_id: z.string().min(1),
    tool: z.string().min(1),
    input: z.unknown(),
    capability: capabilityRequestSchema,
  })
  .strict();

export const toolResultV1 = z
  .object({
    kind: z.literal("tool_result"),
    schemaVersion: z.literal(1),
    call_id: z.string().min(1),
    preview: z.string(),
    blob_ref: z.string().min(1).optional(),
    truncated: z.boolean(),
    bytes: z.number().int().nonnegative(),
    status: toolStatusSchema,
  })
  .strict();

export const permissionV1 = z
  .object({
    kind: z.literal("permission"),
    schemaVersion: z.literal(1),
    call_id: z.string().min(1),
    decision: z.enum(["allow", "deny"]),
    scope: z.enum(["once", "session"]),
    decided_by: z.enum(["user", "rule", "timeout"]),
    reason: z.string(),
  })
  .strict();

/**
 * permission v2 (LRN-21d): `decision` gains `ask` so every evaluation —
 * including fail-safe defaults — is journalable (AC-21.7), and `decided_by`
 * gains `system` for the paths no rule or user produced (thrown-error deny,
 * default ask). v1 stays readable via the version registry.
 */
export const permissionV2 = z
  .object({
    kind: z.literal("permission"),
    schemaVersion: z.literal(2),
    call_id: z.string().min(1),
    decision: z.enum(["allow", "deny", "ask"]),
    scope: z.enum(["once", "session"]),
    decided_by: z.enum(["user", "rule", "timeout", "system"]),
    reason: z.string(),
  })
  .strict();

export const checkpointV1 = z
  .object({
    kind: z.literal("checkpoint"),
    schemaVersion: z.literal(1),
    files: z.array(fileSnapshotSchema),
    restorable: z.boolean(),
  })
  .strict();

/**
 * prompt (LRN-09/AC-9.5): which instruction files entered the system prompt,
 * by content hash, so an edited AGENTS.md/CLAUDE.md is visible in the
 * journal even though assembly itself is fs-free. LRN-20 owns discovery and
 * may extend this to v2.
 */
export const promptV1 = z
  .object({
    kind: z.literal("prompt"),
    schemaVersion: z.literal(1),
    instructions: z.array(fileSnapshotSchema),
  })
  .strict();

/** A durable provider or local turn failure (LRN-10/AC-10.4). */
export const errorEntryV1 = z
  .object({
    kind: z.literal("error"),
    schemaVersion: z.literal(1),
    source: z.enum(["provider", "local"]),
    reason: z.string().min(1),
    message: z.string(),
    status: z.number().int().optional(),
    retryable: z.boolean(),
  })
  .strict();

export const compactionV1 = z
  .object({
    kind: z.literal("compaction"),
    schemaVersion: z.literal(1),
    covers: z
      .object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      })
      .strict(),
    summary: structuredSummarySchema,
  })
  .strict();

export const repairV1 = z
  .object({
    kind: z.literal("repair"),
    schemaVersion: z.literal(1),
    reason: z.string(),
    truncated_from: z.number().int().positive(),
  })
  .strict();

export const turnEndV1 = z
  .object({
    kind: z.literal("turn_end"),
    schemaVersion: z.literal(1),
    usage: usageSchema,
    cost_usd: z.number().nonnegative().optional(),
  })
  .strict();

export type SessionStart = z.infer<typeof sessionStartV1>;
export type UserMessage = z.infer<typeof userMessageV1>;
export type AssistantMessage =
  | z.infer<typeof assistantMessageV1>
  | z.infer<typeof assistantMessageV2>;
export type ToolCall = z.infer<typeof toolCallV1>;
export type ToolResult = z.infer<typeof toolResultV1>;
export type Permission = z.infer<typeof permissionV1> | z.infer<typeof permissionV2>;
export type Checkpoint = z.infer<typeof checkpointV1>;
export type Compaction = z.infer<typeof compactionV1>;
export type Repair = z.infer<typeof repairV1>;
export type TurnEnd = z.infer<typeof turnEndV1>;
export type Prompt = z.infer<typeof promptV1>;
export type ErrorEntry = z.infer<typeof errorEntryV1>;

function v1(schema: z.ZodType): ReadonlyMap<number, z.ZodType> {
  return new Map([[1, schema]]);
}

export const ENTRY_SCHEMAS = {
  session_start: v1(sessionStartV1),
  user_message: v1(userMessageV1),
  assistant_message: new Map<number, z.ZodType>([
    [1, assistantMessageV1],
    [2, assistantMessageV2],
  ]),
  tool_call: v1(toolCallV1),
  tool_result: v1(toolResultV1),
  permission: new Map<number, z.ZodType>([
    [1, permissionV1],
    [2, permissionV2],
  ]),
  checkpoint: v1(checkpointV1),
  compaction: v1(compactionV1),
  repair: v1(repairV1),
  turn_end: v1(turnEndV1),
  prompt: v1(promptV1),
  error: v1(errorEntryV1),
} satisfies Record<string, ReadonlyMap<number, z.ZodType>>;

export type EntryKind = keyof typeof ENTRY_SCHEMAS;

export const ENTRY_KINDS = Object.keys(ENTRY_SCHEMAS) as EntryKind[];

export type Entry =
  | SessionStart
  | UserMessage
  | AssistantMessage
  | ToolCall
  | ToolResult
  | Permission
  | Checkpoint
  | Compaction
  | Repair
  | TurnEnd
  | Prompt
  | ErrorEntry;
