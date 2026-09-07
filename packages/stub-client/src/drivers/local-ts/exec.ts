/**
 * Program execution for the local-ts driver (LRN-13, AC-13.3, AC-13.4).
 *
 * `spawn(program, argv, { shell: false })` always — never exec/execFile with
 * a string, never `shell: true`, so `"; rm -rf x"` passed as an argv element
 * stays a literal argument. stdout/stderr stream as events under one shared
 * byte budget; the maxMs deadline kills with SIGTERM, then SIGKILL after a
 * grace period.
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { ExecEvent } from "@om-code/protocol";
import { StubError } from "../../errors.js";
import { createByteCounter, createDeadline, elapsedMsSince, sleep } from "./budget.js";

export type ExecRequest = {
  readonly program: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly maxBytes: number;
  readonly maxMs: number;
  readonly callerSignal: AbortSignal;
  readonly startedAt: number;
};

const KILL_GRACE_MS = 250;

type Pending =
  | { kind: "stdout"; bytes: Buffer }
  | { kind: "stderr"; bytes: Buffer }
  | { kind: "spawn-error"; error: Error }
  | { kind: "close"; code: number | null; signal: NodeJS.Signals | null };

export async function* runExec(request: ExecRequest): AsyncIterable<ExecEvent> {
  const deadline = createDeadline(request.callerSignal, request.maxMs);
  const counter = createByteCounter(request.maxBytes);
  try {
    yield* run(request, deadline, counter);
  } finally {
    deadline.dispose();
  }
}

async function* run(
  request: ExecRequest,
  deadline: { readonly signal: AbortSignal; readonly timedOut: boolean },
  counter: { readonly used: number; allow(wanted: number): { emit: number; exhausted: boolean } },
): AsyncIterable<ExecEvent> {
  let child: ChildProcess;
  try {
    child = spawn(request.program, request.argv, {
      cwd: request.cwd,
      env: request.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new StubError("io", `cannot spawn program: ${(error as Error).message}`, {
      program: request.program,
    });
  }

  const pending: Pending[] = [];
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  let closed: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawnError: Error | undefined;
  let tearingDown = false;

  child.stdout?.on("data", (chunk: Buffer) => {
    pending.push({ kind: "stdout", bytes: chunk });
    notify();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    pending.push({ kind: "stderr", bytes: chunk });
    notify();
  });
  child.on("error", (error) => {
    spawnError = error;
    notify();
  });
  child.on("close", (code, signal) => {
    closed = { code, signal };
    notify();
  });

  const tearDown = (escalate: boolean) => {
    if (tearingDown || child.exitCode !== null || child.signalCode !== null) return;
    tearingDown = true;
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.kill("SIGTERM");
    if (escalate) {
      void sleep(KILL_GRACE_MS).then(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      });
    }
  };

  const waitForProgress = async () => {
    if (pending.length === 0 && closed === undefined && spawnError === undefined) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (pending.length > 0 || closed !== undefined || spawnError !== undefined) {
          wake = undefined;
          resolve();
        }
      });
    }
  };

  let truncated = false;
  let status = "ok" as "ok" | "failed" | "timeout";
  let failure: { kind: string; message: string } | undefined;
  let killSignal: string | null = null;

  const onDeadline = () => {
    status = "timeout";
    failure = deadline.timedOut
      ? { kind: "deadline", message: `exceeded maxMs ${request.maxMs}` }
      : { kind: "aborted", message: "caller aborted the run" };
    killSignal = "SIGTERM";
    tearDown(true);
  };
  if (deadline.signal.aborted) {
    onDeadline();
  } else {
    deadline.signal.addEventListener("abort", onDeadline, { once: true });
  }

  try {
    for (;;) {
      const next = pending.shift();
      if (next === undefined) {
        if (spawnError !== undefined) {
          const code = (spawnError as NodeJS.ErrnoException).code;
          throw new StubError("io", `cannot spawn program: ${spawnError.message}`, {
            program: request.program,
            ...(code === undefined ? {} : { code }),
          });
        }
        if (closed !== undefined) break;
        await waitForProgress();
        continue;
      }
      if (next.kind === "spawn-error") {
        const code = (next.error as NodeJS.ErrnoException).code;
        throw new StubError("io", `cannot spawn program: ${next.error.message}`, {
          program: request.program,
          ...(code === undefined ? {} : { code }),
        });
      }
      if (next.kind === "close") {
        closed = { code: next.code, signal: next.signal };
        if (pending.length === 0) break;
        continue;
      }
      const allowance = counter.allow(next.bytes.length);
      if (allowance.emit > 0) {
        yield {
          type: next.kind,
          bytes: new Uint8Array(next.bytes.subarray(0, allowance.emit)),
        };
      }
      if (allowance.exhausted && !truncated) {
        truncated = true;
        // The pipe would otherwise back-pressure a chatty child forever, so
        // stop the stream by tearing the pipes down; the terminal frame below
        // still reports status ok — truncation is normal, not a failure.
        tearDown(true);
      }
    }
  } finally {
    deadline.signal.removeEventListener("abort", onDeadline);
  }

  // A truncated stream stays status ok even though the teardown kill shows up
  // as a close signal below — truncation is a normal outcome, not a failure.
  if (status !== "timeout" && !truncated && closed !== undefined) {
    if (closed.code === 0 && closed.signal === null) {
      status = "ok";
    } else {
      status = "failed";
      failure =
        closed.signal !== null
          ? { kind: "killed", message: `process exited on signal ${closed.signal}` }
          : { kind: "non-zero-exit", message: `process exited with code ${closed.code}` };
    }
  }
  if (status === "timeout" && closed !== undefined && closed.signal !== null)
    killSignal = closed.signal;

  const frame = {
    status,
    bytes: counter.used,
    truncated,
    elapsedMs: elapsedMsSince(request.startedAt),
  };
  yield {
    type: "end",
    frame:
      failure === undefined
        ? {
            ...frame,
            exitCode: closed?.code ?? null,
            signal: closed?.signal ?? killSignal,
          }
        : {
            ...frame,
            failure,
            exitCode: closed?.code ?? null,
            signal: closed?.signal ?? killSignal,
          },
  };
}
