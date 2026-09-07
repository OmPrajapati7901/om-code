/**
 * Stub boundary owned by tools (LRN-16).
 *
 * `stub-client`'s `StubClient` satisfies this port structurally, so tools
 * never imports another adapter (dependency-cruiser `tools-does-not-cross`)
 * — the same shape kernel's `JournalSink` has with storage. Seven of the
 * port's nine methods: `health` and `batch` are composition-root concerns,
 * not tool concerns.
 */

import type {
  ExecEvent,
  ExecParams,
  GlobParams,
  GlobResult,
  GrepEvent,
  GrepParams,
  ReadEvent,
  ReadParams,
  ShellParams,
  StatParams,
  StatResult,
  WriteParams,
  WriteResult,
} from "@om-code/protocol";

export type ToolIo = {
  read(params: ReadParams, signal: AbortSignal): AsyncIterable<ReadEvent>;
  write(params: WriteParams, signal: AbortSignal): Promise<WriteResult>;
  stat(params: StatParams, signal: AbortSignal): Promise<StatResult>;
  glob(params: GlobParams, signal: AbortSignal): Promise<GlobResult>;
  grep(params: GrepParams, signal: AbortSignal): AsyncIterable<GrepEvent>;
  exec(params: ExecParams, signal: AbortSignal): AsyncIterable<ExecEvent>;
  shell(params: ShellParams, signal: AbortSignal): AsyncIterable<ExecEvent>;
};
