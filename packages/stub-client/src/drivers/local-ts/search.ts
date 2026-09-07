/**
 * ripgrep-backed search for the local-ts driver (LRN-13, AC-13.5, ADR-025).
 *
 * `glob` delegates to `rg --files` and `grep` to `rg --json` — ignore-aware
 * by construction, so parity with rg holds rather than being chased. Every
 * pattern is validated through the dialect contract BEFORE spawning, so a
 * rejected pattern is a boundary `unsupported-pattern` error and never an rg
 * exit code. A missing rg binary surfaces as a named prerequisite failure
 * (`brew install ripgrep`), which AC-35.1 later turns into an `om doctor`
 * check.
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { GlobResult, GrepEvent, GrepMatch } from "@om-code/protocol";
import { assertSupportedGlob, assertSupportedRegex } from "../../dialect.js";
import { StubError } from "../../errors.js";
import { createByteCounter, createDeadline, elapsedMsSince, sleep } from "./budget.js";

export type SearchBase = {
  readonly rg: string;
  readonly searchRoot: string;
  readonly maxBytes: number;
  readonly maxMs: number;
  readonly callerSignal: AbortSignal;
  readonly startedAt: number;
};

const KILL_GRACE_MS = 250;

function rgMissing(rg: string): StubError {
  return new StubError(
    "io",
    `ripgrep binary not found: ${JSON.stringify(rg)} — install it with \`brew install ripgrep\` and ensure it is on PATH`,
    { program: rg, remediation: "brew install ripgrep" },
  );
}

function elapsed(startedAt: number): number {
  return elapsedMsSince(startedAt);
}

type CollectedLine = { line: string; bytes: number };

/**
 * Runs rg, splits stdout into lines, and enforces the output byte budget.
 * Resolves with the lines (each without its newline), whether the budget
 * truncated the listing, and whether the deadline fired.
 */
async function runRgLines(
  args: readonly string[],
  base: SearchBase,
): Promise<{
  lines: CollectedLine[];
  truncated: boolean;
  timedOut: boolean;
  exitCode: number | null;
  stderrText: string;
}> {
  const deadline = createDeadline(base.callerSignal, base.maxMs);
  const counter = createByteCounter(base.maxBytes);
  let child: ChildProcess;
  try {
    child = spawn(base.rg, [...args], {
      cwd: base.searchRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    deadline.dispose();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw rgMissing(base.rg);
    throw new StubError("io", `cannot spawn ripgrep: ${(error as Error).message}`, {
      program: base.rg,
    });
  }

  const lines: CollectedLine[] = [];
  let truncated = false;
  let timedOut = false;
  let remainder = Buffer.alloc(0);
  let stderrText = "";
  let spawnError: Error | undefined;
  let exitCode: number | null = null;

  const kill = () => {
    child.stdout?.destroy();
    child.kill("SIGTERM");
    void sleep(KILL_GRACE_MS).then(() => {
      if (exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already reaped between the check and the kill.
        }
      }
    });
  };

  const onAbort = () => {
    timedOut = true;
    kill();
  };
  if (deadline.signal.aborted) {
    onAbort();
  } else {
    deadline.signal.addEventListener("abort", onAbort, { once: true });
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    if (truncated || timedOut) return;
    remainder = Buffer.concat([remainder, chunk]);
    for (;;) {
      const newline = remainder.indexOf(0x0a);
      if (newline < 0) break;
      const raw = remainder.subarray(0, newline);
      remainder = remainder.subarray(newline + 1);
      const allowance = counter.allow(raw.length + 1);
      if (allowance.emit > 0) lines.push({ line: raw.toString("utf8"), bytes: raw.length });
      if (allowance.exhausted) {
        truncated = true;
        kill();
        break;
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrText = `${stderrText}${chunk.toString("utf8")}`.slice(-4096);
  });
  const done = new Promise<void>((resolve) => {
    child.on("error", (error) => {
      spawnError = error;
      resolve();
    });
    child.on("close", (code) => {
      exitCode = code;
      resolve();
    });
  });
  await done;
  deadline.signal.removeEventListener("abort", onAbort);
  deadline.dispose();

  if (spawnError !== undefined) {
    if ((spawnError as NodeJS.ErrnoException).code === "ENOENT") throw rgMissing(base.rg);
    throw new StubError("io", `cannot spawn ripgrep: ${spawnError.message}`, { program: base.rg });
  }
  if (remainder.length > 0 && !truncated && !timedOut) {
    const allowance = counter.allow(remainder.length);
    if (allowance.emit > 0)
      lines.push({ line: remainder.subarray(0, allowance.emit).toString("utf8"), bytes: 0 });
    if (allowance.exhausted) truncated = true;
  }
  return { lines, truncated, timedOut, exitCode, stderrText };
}

function rgFailed(exitCode: number | null, stderrText: string, rg: string): StubError {
  return new StubError("io", `ripgrep failed with exit code ${exitCode}: ${stderrText.trim()}`, {
    program: rg,
  });
}
/**
 * rg's `--glob` "always overrides any other ignore logic" (documented), so a
 * glob-selected query alone would leak gitignored files. The driver therefore
 * intersects it with rg's own ignore-aware universe listing (`rg --files`
 * without `--glob`). Both sides are computed by rg — exact path-string
 * intersection, no reimplemented ignore precedence or glob matcher (ADR-025).
 * `--no-require-git` keeps ignore files honored outside a git checkout too.
 */
async function ignoreAwareUniverse(
  base: SearchBase,
  includeIgnored: boolean,
): Promise<Set<string>> {
  const args = ["--files", "--no-require-git", "--sort", "path"];
  if (includeIgnored) args.push("--no-ignore");
  const universe = await runRgLines(args, {
    ...base,
    maxBytes: Number.MAX_SAFE_INTEGER,
  });
  if (universe.exitCode !== 0 && universe.exitCode !== null)
    throw rgFailed(universe.exitCode, universe.stderrText, base.rg);
  return new Set(universe.lines.map((entry) => entry.line).filter((line) => line.length > 0));
}

export async function globSearch(
  pattern: string,
  includeIgnored: boolean,
  base: SearchBase,
): Promise<GlobResult> {
  assertSupportedGlob(pattern);
  const args = ["--files", "--no-require-git", "--sort", "path", "--glob", pattern];
  if (includeIgnored) args.push("--no-ignore");
  const [selected, universe] = await Promise.all([
    runRgLines(args, base),
    ignoreAwareUniverse(base, includeIgnored),
  ]);
  const { lines, truncated, timedOut, exitCode, stderrText } = selected;
  // Like grep, `rg --files` exits 1 when nothing matched — empty, not failure.
  if (exitCode !== 0 && exitCode !== 1 && exitCode !== null)
    throw rgFailed(exitCode, stderrText, base.rg);
  const paths = lines
    .map((entry) => entry.line)
    .filter((line) => line.length > 0 && universe.has(line));
  paths.sort();
  return {
    status: timedOut ? "timeout" : "ok",
    bytes: lines.reduce((total, entry) => total + entry.bytes, 0),
    truncated,
    elapsedMs: elapsed(base.startedAt),
    paths,
  };
}

export type GrepRequest = {
  readonly pattern: string;
  readonly globs: readonly string[];
  readonly caseInsensitive: boolean;
  readonly maxMatchesPerFile: number | undefined;
};

function parseMatchEvent(line: string): GrepMatch | undefined {
  let event: {
    type?: unknown;
    data?: {
      path?: { text?: unknown };
      lines?: { text?: unknown };
      line_number?: unknown;
      absolute_offset?: unknown;
      submatches?: { start?: unknown; end?: unknown }[];
    };
  };
  try {
    event = JSON.parse(line) as typeof event;
  } catch {
    throw new StubError("io", "ripgrep emitted malformed JSON", { program: "rg" });
  }
  if (event.type !== "match" || event.data === undefined) return undefined;
  const { data } = event;
  const path = data.path?.text;
  const text = data.lines?.text;
  if (typeof path !== "string" || typeof text !== "string") return undefined;
  if (typeof data.line_number !== "number" || typeof data.absolute_offset !== "number")
    return undefined;
  const submatches = (data.submatches ?? []).map((sub) => {
    if (typeof sub.start !== "number" || typeof sub.end !== "number")
      throw new StubError("io", "ripgrep emitted a malformed submatch", { program: "rg" });
    return { start: sub.start, end: sub.end };
  });
  return {
    path,
    lineNumber: data.line_number,
    byteOffset: data.absolute_offset,
    line: text.endsWith("\n") ? text.slice(0, -1) : text,
    submatches,
  };
}

export async function* grepSearch(
  request: GrepRequest,
  base: SearchBase,
): AsyncIterable<GrepEvent> {
  assertSupportedRegex(request.pattern);
  for (const glob of request.globs) assertSupportedGlob(glob);
  // Without a user `--glob`, rg already honours ignore files; with one, the
  // glob would override them, so intersect with the ignore-aware universe.
  const universe = request.globs.length > 0 ? await ignoreAwareUniverse(base, false) : undefined;
  const args = ["--json", "--no-require-git", "--sort", "path", "-e", request.pattern];
  for (const glob of request.globs) args.push("--glob", glob);
  if (request.caseInsensitive) args.push("-i");
  if (request.maxMatchesPerFile !== undefined)
    args.push("--max-count", String(request.maxMatchesPerFile));
  args.push("--max-filesize", String(base.maxBytes));
  const { lines, truncated, timedOut, exitCode, stderrText } = await runRgLines(args, base);
  // rg exits 1 on "no match" — an empty result, not a failure. Exit 2 is an
  // engine error (patterns were pre-validated, so this is genuinely I/O).
  if (exitCode !== 0 && exitCode !== 1 && exitCode !== null)
    throw rgFailed(exitCode, stderrText, base.rg);
  for (const entry of lines) {
    if (entry.line.length === 0) continue;
    const match = parseMatchEvent(entry.line);
    if (match === undefined) continue;
    if (universe !== undefined && !universe.has(match.path)) continue;
    yield { type: "match", match };
  }
  yield {
    type: "end",
    frame: {
      status: timedOut ? "timeout" : "ok",
      bytes: lines.reduce((total, entry) => total + entry.bytes, 0),
      truncated,
      elapsedMs: elapsed(base.startedAt),
    },
  };
}
