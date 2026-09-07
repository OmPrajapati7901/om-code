/**
 * LRN-06: deterministic projection only; no clock, filesystem or execution.
 * Pending calls are IDs, not guessed outcomes. LRN-29 owns reconciliation.
 * Unknown entries survive intact; absent metadata never becomes resumable.
 */
import type {
  AssistantMessage,
  Checkpoint,
  Compaction,
  ErrorEntry,
  Permission,
  Prompt,
  ReadableRecord,
  Repair,
  SessionMeta,
  ToolCall,
  ToolResult,
  UnknownEntry,
  UserMessage,
} from "@om-code/protocol";

export type SessionView = {
  meta: SessionMeta | undefined;
  lastSeq: number;
  lastActivityAt: string | undefined;
  conversation: (UserMessage | AssistantMessage)[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  pendingCallIds: string[];
  permissions: Permission[];
  checkpoints: Checkpoint[];
  compactions: Compaction[];
  repairs: Repair[];
  prompts: Prompt[];
  errors: ErrorEntry[];
  unknownEntries: UnknownEntry[];
  diagnostics: string[];
  resumable: boolean;
};

export function materialize(records: readonly ReadableRecord[]): SessionView {
  const view: SessionView = {
    meta: undefined,
    lastSeq: 0,
    lastActivityAt: undefined,
    conversation: [],
    toolCalls: [],
    toolResults: [],
    pendingCallIds: [],
    permissions: [],
    checkpoints: [],
    compactions: [],
    repairs: [],
    prompts: [],
    errors: [],
    unknownEntries: [],
    diagnostics: [],
    resumable: false,
  };
  const pending = new Set<string>();
  for (const record of records) {
    view.lastSeq = record.seq;
    view.lastActivityAt = record.ts;
    const entry = record.entry;
    switch (entry.kind) {
      case "session_start":
        if (view.meta) view.diagnostics.push("duplicate session_start");
        else view.meta = structuredClone(entry.meta);
        break;
      case "user_message":
      case "assistant_message":
        view.conversation.push(structuredClone(entry));
        break;
      case "tool_call":
        view.toolCalls.push(structuredClone(entry));
        pending.add(entry.call_id);
        break;
      case "tool_result":
        view.toolResults.push(structuredClone(entry));
        pending.delete(entry.call_id);
        break;
      case "permission":
        view.permissions.push(structuredClone(entry));
        break;
      case "checkpoint":
        view.checkpoints.push(structuredClone(entry));
        break;
      case "compaction":
        view.compactions.push(structuredClone(entry));
        break;
      case "repair":
        view.repairs.push(structuredClone(entry));
        break;
      case "prompt":
        view.prompts.push(structuredClone(entry));
        break;
      case "error":
        view.errors.push(structuredClone(entry));
        break;
      case "unknown_entry":
        view.unknownEntries.push(structuredClone(entry));
        view.diagnostics.push(`unknown entry kind ${entry.original_kind} at seq ${record.seq}`);
        break;
      case "turn_end":
        break;
    }
    if (view.meta) {
      view.meta.updated_at = record.ts;
      if (entry.kind === "user_message") view.meta.status = "active";
      if (entry.kind === "turn_end") view.meta.status = "idle";
    }
  }
  view.pendingCallIds = [...pending];
  if (!view.meta) view.diagnostics.push("missing session_start");
  view.resumable = view.meta !== undefined && view.diagnostics.length === 0;
  return view;
}
