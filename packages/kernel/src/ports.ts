import type {
  Actor,
  CompleteToolCall,
  Entry,
  JournalRecord,
  ToolCall,
  ToolStatus,
} from "@om-code/protocol";

/** Durable journal boundary owned by the kernel; storage satisfies it structurally. */
export type JournalSink = {
  append(entry: Entry, context: { by: Actor; turn_id?: string }): Promise<JournalRecord>;
};

/** One executed call's terminal outcome — structurally `toolResultV1` minus `call_id`. */
export type ToolOutcome = {
  readonly status: ToolStatus;
  readonly preview: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly blob_ref?: string;
};

/**
 * Tool-execution boundary owned by the kernel; the CLI's tools+stub
 * composition satisfies it structurally. `record` is awaited before any
 * effect (AC-16.6); the kernel appends the matching `tool_result` itself.
 */
export type ToolRunner = {
  run(
    call: CompleteToolCall,
    deps: { readonly record: (call: ToolCall) => Promise<void>; readonly signal: AbortSignal },
  ): Promise<ToolOutcome>;
};
