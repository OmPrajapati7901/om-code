/**
 * Byte and time budgets shared by every streaming source (LRN-13, AC-13.3).
 *
 * maxBytes — bytes are counted as they leave the source; on exceeding, the
 * stream stops and the terminal frame carries truncated: true with status
 * "ok". Truncation is a normal outcome, not a failure.
 *
 * maxMs — a deadline timer aborts through the method's AbortSignal shape the
 * port already commits to; the terminal frame is status "timeout" with the
 * real elapsedMs. elapsedMs is measured from method entry on every terminal
 * frame, success or not.
 */

export function elapsedMsSince(startedAt: number): number {
  return Date.now() - startedAt;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Counts emitted bytes against maxBytes. `allow(wanted)` returns how many of
 * the wanted bytes may be emitted now (the caller slices to fit) and whether
 * the budget is now exhausted.
 */
export type ByteCounter = {
  readonly used: number;
  allow(wanted: number): { emit: number; exhausted: boolean };
};

export function createByteCounter(maxBytes: number): ByteCounter {
  let used = 0;
  return {
    get used() {
      return used;
    },
    allow(wanted: number) {
      const room = maxBytes - used;
      if (room <= 0) return { emit: 0, exhausted: true };
      const emit = Math.min(room, wanted);
      used += emit;
      return { emit, exhausted: used >= maxBytes };
    },
  };
}

export type DeadlineReason = "deadline" | "caller-abort";

export type Deadline = {
  readonly signal: AbortSignal;
  readonly timedOut: boolean;
  readonly callerAborted: boolean;
  dispose(): void;
};

/**
 * Links the caller's AbortSignal with the maxMs deadline into one signal.
 * The timer aborts with reason "deadline" (a real timeout); a caller abort
 * keeps its own reason. Either way the driver stops the stream and reports
 * status "timeout" — the frame vocabulary has no cancelled state, and the
 * recorded reason stays in `timedOut`/`callerAborted` for the message.
 */
export function createDeadline(caller: AbortSignal, maxMs: number): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => {
    controller.abort(caller.reason ?? "caller-abort");
  };
  if (caller.aborted) {
    onCallerAbort();
  } else {
    caller.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort("deadline" satisfies DeadlineReason);
  }, maxMs);
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    get callerAborted() {
      return controller.signal.aborted && !timedOut;
    },
    dispose() {
      clearTimeout(timer);
      caller.removeEventListener("abort", onCallerAbort);
    },
  };
}
