import type { Actor, Entry, JournalRecord } from "@om-code/protocol";

/** Durable journal boundary owned by the kernel; storage satisfies it structurally. */
export type JournalSink = {
  append(entry: Entry, context: { by: Actor; turn_id?: string }): Promise<JournalRecord>;
};
