/**
 * Central result bounding (LRN-19, AC-19.2/19.3/19.4/19.7).
 *
 * The only module that truncates tool output. `toolResultV1` is `.strict()`,
 * so the structured notice lives inside `preview` and `blob_ref` carries the
 * machine-readable half — no schema bump. `bytes` keeps the true total while
 * `preview` stays inside budget.
 */

import type { ToolStatus } from "@om-code/protocol";
import type { BlobStore } from "./ports.js";

export type BoundOutcome = {
  readonly status: ToolStatus;
  readonly preview: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly blob_ref?: string;
};

export type BoundInput = {
  readonly status: ToolStatus;
  readonly preview: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly blob_ref?: string;
};

export type BoundOptions = {
  /** Operator-marked opt-out (AC-19.7): set by `--notrunc`, never by the model. */
  readonly notrunc?: boolean;
};

export type Bounder = {
  bound(outcome: BoundInput, opts?: BoundOptions): Promise<BoundOutcome>;
};

/** Byte length of the separator the notice is joined with. */
const NOTICE_SEPARATOR = "\n";

function noticeFor(totalBytes: number, shownBytes: number, ref: string): string {
  return (
    `[om: output truncated — ${totalBytes} bytes total, ` +
    `first ${shownBytes} shown; full output at ${ref}]`
  );
}

/**
 * Cut `text` to at most `budget` UTF-8 bytes without splitting a multi-byte
 * character: slice the buffer, then back off over trailing continuation
 * bytes (`10xxxxxx`).
 */
export function cutAtCharBoundary(text: string, budget: number): string {
  if (budget <= 0) return "";
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= budget) return text;
  let end = budget;
  while (end > 0) {
    const byte = bytes[end];
    if (byte === undefined || byte < 0x80 || byte >= 0xc0) break;
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

export function createBounder(deps: {
  readonly blobs: BlobStore;
  readonly maxResultBytes: number;
}): Bounder {
  return {
    async bound(outcome: BoundInput, opts: BoundOptions = {}): Promise<BoundOutcome> {
      if (opts.notrunc) return { ...outcome };
      if (Buffer.byteLength(outcome.preview, "utf8") <= deps.maxResultBytes) {
        return { ...outcome };
      }
      const fullBytes = Buffer.from(outcome.preview, "utf8");
      const ref = await deps.blobs.put(fullBytes);
      // Build the notice first — its length is known once the hash is — then
      // size the head so head + separator + notice fits the budget exactly.
      const headBudget = (() => {
        // Iterate once: the shown count depends on the head, the head depends
        // on the notice, the notice depends on the shown count. Converges
        // immediately because only the digit width can shift.
        let shown = deps.maxResultBytes;
        for (let i = 0; i < 3; i += 1) {
          const probe = noticeFor(outcome.bytes, shown, ref);
          const next = deps.maxResultBytes - Buffer.byteLength(NOTICE_SEPARATOR + probe, "utf8");
          if (next === shown) return next;
          shown = next;
        }
        return shown;
      })();
      const head = cutAtCharBoundary(outcome.preview, Math.max(0, headBudget));
      const shownBytes = Buffer.byteLength(head, "utf8");
      const notice = noticeFor(outcome.bytes, shownBytes, ref);
      const full = `${head}${NOTICE_SEPARATOR}${notice}`;
      // Degenerate budgets (smaller than the notice itself) still obey the
      // hard invariant: cut the joined text at a character boundary. The ref
      // always survives in `blob_ref`, the machine-readable half.
      const preview =
        Buffer.byteLength(full, "utf8") <= deps.maxResultBytes
          ? full
          : cutAtCharBoundary(full, deps.maxResultBytes);
      return {
        status: outcome.status,
        preview,
        bytes: outcome.bytes,
        truncated: true,
        blob_ref: ref,
      };
    },
  };
}
