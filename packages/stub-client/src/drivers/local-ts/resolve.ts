/**
 * Handle-based path resolution (LRN-13, AC-13.1, LR-FR-008, T3).
 *
 * One shared module used by every path-taking method — no method resolves a
 * path its own way. The pipeline is: join against the envelope cwd (whose own
 * containment is asserted first) → canonicalize with `fs.realpathSync.native`
 * (never `fs.realpath`; dialect.ts pins this so Node and Rust agree in M4) →
 * assert containment with `isInsideRoot` (reused, never a second prefix
 * check) → lstat and record dev/ino → open with O_NOFOLLOW on the final
 * component → re-verify after open (fstat dev/ino equality, re-canonicalize,
 * re-assert containment) → act on the handle only.
 *
 * REJECTS: any resolution that checks before opening and then acts on the
 * name. No method may re-open by name after this point — every byte flows
 * through the returned fd. Open happens exactly once per resolution, in this
 * module.
 *
 * A path that does not yet exist (stat of a missing file; write's future
 * needs) follows dialect.ts's recipe: canonicalize the deepest existing
 * ancestor, assert containment, then join the remaining components after
 * asserting each contains no `.`, `..` or separator.
 */

import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { isInsideRoot } from "../../dialect.js";
import { StubError } from "../../errors.js";

export type VerifiedHandle = {
  readonly fd: number;
  readonly canonicalPath: string;
  close(): void;
};

export type MissingPath = {
  readonly ancestorCanonical: string;
  readonly remaining: readonly string[];
  readonly fullCanonical: string;
};

function ioError(message: string, details: Readonly<Record<string, unknown>>): StubError {
  return new StubError("io", message, details);
}

function escapeError(path: string, reason: string): StubError {
  return new StubError("path-escape", `path escapes the workspace root: ${reason}`, { path });
}

/** Canonicalize exactly the way LRN-30's Rust driver will: OS, fully resolved. */
export function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw error;
    throw ioError(`cannot canonicalize path: ${(error as Error).message}`, { path });
  }
}

/**
 * Assert the envelope cwd itself is inside the root. Runs before any join —
 * a hostile cwd fails closed even when the caller path looks innocent.
 */
export function assertCwd(rootCanonical: string, cwd: string): string {
  const joined = isAbsolute(cwd) ? cwd : join(rootCanonical, cwd);
  let canonical: string;
  try {
    canonical = canonicalize(joined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw ioError(`working directory does not exist: ${cwd}`, { cwd });
    throw error;
  }
  if (!isInsideRoot(rootCanonical, canonical)) throw escapeError(cwd, "cwd is outside the root");
  return canonical;
}

/** Join the caller path against the envelope cwd and canonicalize. */
function joinAndCanonicalize(cwdCanonical: string, callerPath: string): string {
  return canonicalize(resolvePath(cwdCanonical, callerPath));
}

function assertInside(rootCanonical: string, canonicalPath: string, shown: string): void {
  if (!isInsideRoot(rootCanonical, canonicalPath))
    throw escapeError(shown, "canonical path is outside the root");
}

/**
 * Open the canonical path and re-verify the handle: fstat dev/ino must equal
 * the pre-open lstat pair, and a fresh canonicalization must still be
 * contained. Any mismatch closes the handle and throws path-escape — this is
 * the clause that makes resolution handle-based rather than name-based.
 */
function openVerified(
  rootCanonical: string,
  canonicalPath: string,
  shown: string,
  recorded: { dev: number; ino: number },
): VerifiedHandle {
  let fd: number;
  try {
    fd = openSync(canonicalPath, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw escapeError(shown, "refused to follow a final symlink");
    if (code === "ENOENT") throw ioError(`no such file: ${shown}`, { path: shown });
    throw ioError(`cannot open path: ${(error as Error).message}`, { path: shown });
  }
  try {
    const after = fstatSync(fd);
    if (after.dev !== recorded.dev || after.ino !== recorded.ino)
      throw escapeError(shown, "file identity changed between check and open");
    const fresh = canonicalize(canonicalPath);
    if (fresh !== canonicalPath || !isInsideRoot(rootCanonical, fresh))
      throw escapeError(shown, "re-canonicalization left the root after open");
    let closed = false;
    return {
      fd,
      canonicalPath,
      close() {
        if (!closed) {
          closed = true;
          closeSync(fd);
        }
      },
    };
  } catch (error) {
    closeSync(fd);
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw escapeError(shown, "file vanished between check and open");
    throw error;
  }
}

/**
 * Resolve an existing path to a verified open handle. Throws path-escape or
 * io; ENOENT from a genuinely missing leaf propagates as io (callers that
 * accept absence use `resolveForStat` instead).
 */
export function resolveOpen(
  rootCanonical: string,
  cwdCanonical: string,
  callerPath: string,
): VerifiedHandle {
  const canonical = joinAndCanonicalize(cwdCanonical, callerPath);
  assertInside(rootCanonical, canonical, callerPath);
  let recorded: { dev: number; ino: number };
  try {
    const before = lstatSync(canonical);
    recorded = { dev: before.dev, ino: before.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw ioError(`no such file: ${callerPath}`, { path: callerPath });
    throw ioError(`cannot stat path: ${(error as Error).message}`, { path: callerPath });
  }
  return openVerified(rootCanonical, canonical, callerPath, recorded);
}

export type Resolved =
  | { kind: "open"; handle: VerifiedHandle }
  | { kind: "missing"; missing: MissingPath };

/**
 * Resolve for callers that accept absence (stat): missing leaves return the
 * containment-checked ancestor recipe instead of throwing.
 */
export function resolveEntry(
  rootCanonical: string,
  cwdCanonical: string,
  callerPath: string,
): Resolved {
  const probe = resolveMissing(rootCanonical, cwdCanonical, callerPath);
  if (probe.remaining.length > 0) return { kind: "missing", missing: probe };
  return { kind: "open", handle: resolveOpen(rootCanonical, cwdCanonical, callerPath) };
}

/**
 * Walk up to the deepest existing ancestor for a path that may not exist.
 * The ancestor is canonicalized and containment-checked; every remaining
 * component must contain no `.`, `..` or separator.
 */
export function resolveMissing(
  rootCanonical: string,
  cwdCanonical: string,
  callerPath: string,
): MissingPath {
  const joined = resolvePath(cwdCanonical, callerPath);
  const remaining: string[] = [];
  let dir = joined;
  for (;;) {
    try {
      lstatSync(dir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw ioError(`cannot stat path: ${(error as Error).message}`, { path: callerPath });
      remaining.unshift(basename(dir));
      const parent = dirname(dir);
      if (parent === dir) throw ioError(`no existing ancestor for path`, { path: callerPath });
      dir = parent;
    }
  }
  const ancestorCanonical = canonicalize(dir);
  assertInside(rootCanonical, ancestorCanonical, callerPath);
  for (const part of remaining) {
    if (part === "" || part === "." || part === ".." || part.includes("/") || part.includes("\\"))
      throw escapeError(callerPath, `unsafe path component ${JSON.stringify(part)}`);
  }
  return {
    ancestorCanonical,
    remaining,
    fullCanonical: remaining.length > 0 ? join(ancestorCanonical, ...remaining) : ancestorCanonical,
  };
}
