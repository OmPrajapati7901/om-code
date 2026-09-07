/**
 * The stub port (LRN-12, AC-12.1–12.3, AC-12.5).
 *
 * Nine method signatures, one shared request envelope, one terminal frame.
 * Contract only — nothing here opens a file or spawns a process (AC-12.5).
 * LRN-13's local-ts driver and LRN-30's Rust stub are both written against
 * this fixed target.
 *
 * The `(params, signal)` shape follows `ModelProvider.stream(request, signal)`
 * (protocol `model.ts`): cancellation is how `maxMs` aborts.
 */

import type {
  BatchParams,
  BatchResult,
  ExecEvent,
  ExecParams,
  GlobParams,
  GlobResult,
  GrepEvent,
  GrepParams,
  HealthParams,
  HealthResult,
  ReadEvent,
  ReadParams,
  ShellParams,
  StatParams,
  StatResult,
  WriteParams,
  WriteResult,
} from "@om-code/protocol";

export const STUB_METHODS = [
  "health",
  "read",
  "write",
  "stat",
  "glob",
  "grep",
  "exec",
  "shell",
  "batch",
] as const;

export type StubMethod = (typeof STUB_METHODS)[number];

export interface StubClient {
  health(params: HealthParams, signal: AbortSignal): Promise<HealthResult>;
  read(params: ReadParams, signal: AbortSignal): AsyncIterable<ReadEvent>;
  write(params: WriteParams, signal: AbortSignal): Promise<WriteResult>;
  stat(params: StatParams, signal: AbortSignal): Promise<StatResult>;
  glob(params: GlobParams, signal: AbortSignal): Promise<GlobResult>;
  grep(params: GrepParams, signal: AbortSignal): AsyncIterable<GrepEvent>;
  exec(params: ExecParams, signal: AbortSignal): AsyncIterable<ExecEvent>;
  shell(params: ShellParams, signal: AbortSignal): AsyncIterable<ExecEvent>;
  batch(params: BatchParams, signal: AbortSignal): Promise<BatchResult>;
}
