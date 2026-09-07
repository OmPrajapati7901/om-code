/**
 * The local-ts driver behind the stub port (LRN-13, LR-FR-007).
 *
 * Real fs and spawn against a workspace root, behind the fixed LRN-12 port:
 * `createLocalDriver({ root, rg? }) => StubClient`. Implemented now: health,
 * read, stat, glob, grep, exec. Deferred to M3: write, shell, batch — those
 * call the existing `notImplemented`, which already names the milestone
 * (AC-12.4); nothing here invents a second throw.
 *
 * The driver is honest that it is not sandboxed: health reports
 * `sandboxProfile: null, enforcement: "unenforced"`. LRN-33 supplies a driver
 * that is not.
 */

import { fstatSync, readSync } from "node:fs";
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
import { notImplemented, StubError } from "../../errors.js";
import type { StubClient } from "../../port.js";
import { createByteCounter, createDeadline, elapsedMsSince, sleep } from "./budget.js";
import { runExec } from "./exec.js";
import { assertCwd, canonicalize, resolveEntry, resolveOpen } from "./resolve.js";
import { globSearch, grepSearch } from "./search.js";

export type LocalDriverOptions = {
  /** Workspace root. Canonicalized once at construction. */
  readonly root: string;
  /** Ripgrep binary path. Defaults to "rg" on PATH (a documented prerequisite). */
  readonly rg?: string;
};

const DRIVER_VERSION = "0.1.0";
const STUB_PROTOCOL_VERSION = 1;
const READ_CHUNK_BYTES = 64 * 1024;

function canonicalRoot(root: string): string {
  try {
    return canonicalize(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new StubError("io", `workspace root does not exist: ${root}`, { root });
    throw error;
  }
}

function buildEnv(
  allowlist: readonly string[],
  extra: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const allowed = new Set(allowlist);
  const env: Record<string, string> = {};
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  if (extra !== undefined) {
    for (const [name, value] of Object.entries(extra)) {
      if (allowed.has(name)) env[name] = value;
    }
  }
  return env;
}

async function* readStream(
  rootCanonical: string,
  params: ReadParams,
  callerSignal: AbortSignal,
  startedAt: number,
): AsyncIterable<ReadEvent> {
  const deadline = createDeadline(callerSignal, params.maxMs);
  const counter = createByteCounter(params.maxBytes);
  let truncated = false;
  let timedOut = deadline.signal.aborted;
  const finish = (status: "ok" | "timeout"): ReadEvent => ({
    type: "end",
    frame: { status, bytes: counter.used, truncated, elapsedMs: elapsedMsSince(startedAt) },
  });
  try {
    if (timedOut) {
      yield finish("timeout");
      return;
    }
    const cwdCanonical = assertCwd(rootCanonical, params.cwd);
    const handle = resolveOpen(rootCanonical, cwdCanonical, params.path);
    try {
      if (params.range === undefined) {
        yield* readRaw(handle.fd, deadline, counter, (value) => {
          truncated = value;
        });
      } else {
        yield* readRanged(handle.fd, params.range, deadline, counter, (value) => {
          truncated = value;
        });
      }
      timedOut = deadline.signal.aborted;
    } finally {
      handle.close();
    }
    yield finish(timedOut ? "timeout" : "ok");
  } finally {
    deadline.dispose();
  }
}

type DeadlineView = { readonly signal: AbortSignal };
type CounterView = {
  readonly used: number;
  allow(wanted: number): { emit: number; exhausted: boolean };
};

async function* readRaw(
  fd: number,
  deadline: DeadlineView,
  counter: CounterView,
  onTruncated: (value: boolean) => void,
): AsyncIterable<ReadEvent> {
  const buffer = Buffer.alloc(READ_CHUNK_BYTES);
  for (;;) {
    if (deadline.signal.aborted) return;
    let read: number;
    try {
      read = readSync(fd, buffer, 0, buffer.length, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        await sleep(10);
        continue;
      }
      throw new StubError("io", `cannot read file: ${(error as Error).message}`, { code });
    }
    if (read === 0) return;
    const allowance = counter.allow(read);
    if (allowance.emit > 0)
      yield { type: "chunk", bytes: new Uint8Array(buffer.subarray(0, allowance.emit)) };
    if (allowance.exhausted) {
      onTruncated(true);
      return;
    }
  }
}

async function* readRanged(
  fd: number,
  range: { readonly startLine: number; readonly endLine: number },
  deadline: DeadlineView,
  counter: CounterView,
  onTruncated: (value: boolean) => void,
): AsyncIterable<ReadEvent> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const buffer = Buffer.alloc(READ_CHUNK_BYTES);
  let carry = "";
  let lineNumber = 0;
  // Returns true once the byte budget is exhausted.
  const emitLine = function* (text: string, newline: boolean): Generator<ReadEvent, boolean> {
    lineNumber += 1;
    if (lineNumber < range.startLine || lineNumber > range.endLine) return false;
    const out = newline ? `${text}\n` : text;
    const encoded = Buffer.from(out, "utf8");
    const allowance = counter.allow(encoded.length);
    if (allowance.emit > 0)
      yield { type: "chunk", bytes: new Uint8Array(encoded.subarray(0, allowance.emit)) };
    return allowance.exhausted;
  };
  let eof = false;
  let exhausted = false;
  while (!eof && !exhausted) {
    if (deadline.signal.aborted) return;
    let read: number;
    try {
      read = readSync(fd, buffer, 0, buffer.length, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        await sleep(10);
        continue;
      }
      throw new StubError("io", `cannot read file: ${(error as Error).message}`, { code });
    }
    if (read === 0) {
      eof = true;
      carry += decoder.decode();
    } else {
      carry += decoder.decode(buffer.subarray(0, read), { stream: true });
    }
    for (;;) {
      const newline = carry.indexOf("\n");
      if (newline < 0) break;
      const text = carry.slice(0, newline);
      carry = carry.slice(newline + 1);
      if (yield* emitLine(text, true)) {
        exhausted = true;
        break;
      }
      if (lineNumber >= range.endLine) return;
    }
  }
  if (!exhausted && carry.length > 0) exhausted = yield* emitLine(carry, false);
  if (exhausted) onTruncated(true);
}

function statEntry(rootCanonical: string, params: StatParams, startedAt: number): StatResult {
  const base = {
    bytes: 0,
    truncated: false,
    elapsedMs: elapsedMsSince(startedAt),
  };
  const cwdCanonical = assertCwd(rootCanonical, params.cwd);
  const resolved = resolveEntry(rootCanonical, cwdCanonical, params.path);
  if (resolved.kind === "missing") {
    return { status: "ok", ...base, entry: null };
  }
  try {
    const st = fstatSync(resolved.handle.fd);
    const kind = st.isFile()
      ? "file"
      : st.isDirectory()
        ? "dir"
        : st.isSymbolicLink()
          ? "symlink"
          : "other";
    return {
      status: "ok",
      ...base,
      entry: {
        path: resolved.handle.canonicalPath,
        kind,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
      },
    };
  } finally {
    resolved.handle.close();
  }
}

function searchRootFor(rootCanonical: string, cwd: string, root: string | undefined): string {
  const cwdCanonical = assertCwd(rootCanonical, cwd);
  if (root === undefined) return cwdCanonical;
  const handle = resolveOpen(rootCanonical, cwdCanonical, root);
  try {
    if (!fstatSync(handle.fd).isDirectory())
      throw new StubError("io", `search root is not a directory: ${root}`, { root });
    return handle.canonicalPath;
  } finally {
    handle.close();
  }
}

export function createLocalDriver(options: LocalDriverOptions): StubClient {
  const rootCanonical = canonicalRoot(options.root);
  const rg = options.rg ?? "rg";
  return {
    health(_params: HealthParams, _signal: AbortSignal): Promise<HealthResult> {
      const startedAt = Date.now();
      return Promise.resolve({
        status: "ok",
        bytes: 0,
        truncated: false,
        elapsedMs: elapsedMsSince(startedAt),
        version: DRIVER_VERSION,
        protocolVersion: STUB_PROTOCOL_VERSION,
        sandboxProfile: null,
        enforcement: "unenforced",
      });
    },

    read(params: ReadParams, signal: AbortSignal): AsyncIterable<ReadEvent> {
      return readStream(rootCanonical, params, signal, Date.now());
    },

    write(_params: WriteParams, _signal: AbortSignal): Promise<WriteResult> {
      notImplemented("write");
    },

    stat(params: StatParams, _signal: AbortSignal): Promise<StatResult> {
      const startedAt = Date.now();
      return Promise.resolve(statEntry(rootCanonical, params, startedAt));
    },

    glob(params: GlobParams, signal: AbortSignal): Promise<GlobResult> {
      const startedAt = Date.now();
      const searchRoot = searchRootFor(rootCanonical, params.cwd, params.root);
      return globSearch(params.pattern, params.includeIgnored ?? false, {
        rg,
        searchRoot,
        maxBytes: params.maxBytes,
        maxMs: params.maxMs,
        callerSignal: signal,
        startedAt,
      });
    },

    grep(params: GrepParams, signal: AbortSignal): AsyncIterable<GrepEvent> {
      const startedAt = Date.now();
      const searchRoot = searchRootFor(rootCanonical, params.cwd, params.root);
      return grepSearch(
        {
          pattern: params.pattern,
          globs: params.globs ?? [],
          caseInsensitive: params.caseInsensitive ?? false,
          maxMatchesPerFile: params.maxMatchesPerFile,
        },
        {
          rg,
          searchRoot,
          maxBytes: params.maxBytes,
          maxMs: params.maxMs,
          callerSignal: signal,
          startedAt,
        },
      );
    },

    exec(params: ExecParams, signal: AbortSignal): AsyncIterable<ExecEvent> {
      const startedAt = Date.now();
      const cwdCanonical = assertCwd(rootCanonical, params.cwd);
      return runExec({
        program: params.program,
        argv: params.argv,
        cwd: cwdCanonical,
        env: buildEnv(params.envAllowlist, params.env),
        maxBytes: params.maxBytes,
        maxMs: params.maxMs,
        callerSignal: signal,
        startedAt,
      });
    },

    shell(_params: ShellParams, _signal: AbortSignal): AsyncIterable<ExecEvent> {
      notImplemented("shell");
    },

    batch(_params: BatchParams, _signal: AbortSignal): Promise<BatchResult> {
      notImplemented("batch");
    },
  };
}
