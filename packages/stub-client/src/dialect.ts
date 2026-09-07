/**
 * Dialect contract (LRN-12, AC-12.6; feeds AC-13.8 and AC-30.5).
 *
 * AC-30.5 says the Rust stub must pass LRN-13's contract suite verbatim, and
 * any change needed to the suite is a defect in the port. Two engine pairs
 * make that unsatisfiable unless the contract pins the semantics now:
 *
 * Regex (`grep`): ripgrep uses the Rust `regex` crate (RE2-style, linear
 * time) — no backreferences, no lookaround — while Node uses JS `RegExp`.
 * Syntax is the Rust `regex` crate's. Constructs valid in JS `RegExp` but
 * absent from `regex` are rejected at the boundary with `StubError` kind
 * `unsupported-pattern` — never silently passed through. Constructs valid in
 * `regex` but absent from JS `RegExp` (inline flags `(?i)`, `\p{…}`) are
 * legal on the wire; a driver that cannot express one must fail
 * `unsupported-pattern`, never degrade silently. (This is a second reason
 * LRN-13 delegates to `rg` instead of `RegExp`.) Matching is line-oriented
 * over UTF-8; `.` does not match `\n`; patterns are unanchored.
 *
 * Suite constraint: every pattern in the contract suite is in the
 * intersection subset. A pattern outside it is a defect in the suite.
 *
 * Glob (`glob`, and `grep`'s `globs`): the accepted subset is literals, `?`,
 * `*`, `**` (whole segment only), `[…]` classes with `!`/`^` negation,
 * `{a,b}` alternation, `\` escapes — the globset intersection. Anything
 * outside it (extglob, regex groups, leading-`!` negation) is rejected at the
 * boundary as `unsupported-pattern`.
 *
 * Path canonicalization: canonicalization is delegated to the OS. Node
 * drivers use `fs.realpath.native`, not `fs.realpath`; Rust drivers use
 * `std::fs::canonicalize`. Both fully resolve symlinks and return an absolute
 * path in the spelling stored on disk. Comparison is byte-exact and
 * segment-wise on that result. Drivers MUST NOT case-fold and MUST NOT apply
 * Unicode normalization (NFC/NFD) before comparing. macOS default volumes are
 * case-insensitive/case-preserving and, on APFS,
 * normalization-insensitive/normalization-preserving, so the OS canonicalizer
 * already collapses those variants to the stored spelling. Folding again in
 * the driver would create a second, divergent notion of equality between Node
 * and Rust — exactly the M4 failure X-14 predicts. A path is inside the root
 * iff it equals the canonical root, or the canonical root plus `/` is a
 * prefix of it, compared per segment (so `/root-evil` is not inside `/root`).
 * Creating a path that does not yet exist: canonicalize the deepest existing
 * ancestor, assert containment, then join the remaining components — which
 * must contain no `.`, `..` or separator — open without following a final
 * symlink, and re-verify after open (AC-13.1).
 *
 * Suite constraint: no two fixture paths may differ only by ASCII case or
 * only by Unicode normalization form, and no assertion may turn on a
 * normalization-equivalence outcome.
 *
 * Read line counting: a line is a maximal run of bytes terminated by 0x0A
 * or EOF. A file without a trailing 0x0A counts its final partial line; an
 * empty file has zero lines. CRLF is one line and its 0x0D is content; a lone
 * 0x0D is not a terminator. Counting is over raw bytes, so invalid UTF-8
 * cannot change the result. It continues beyond a requested range and the
 * emitted-byte budget; only a time-budget stop makes `totalLines` unknown.
 */

import { StubError } from "./errors.js";

function unsupported(what: string, pattern: string): never {
  throw new StubError(
    "unsupported-pattern",
    `unsupported ${what} in pattern ${JSON.stringify(pattern)}`,
    {
      pattern,
    },
  );
}

const FLAG_CHARS = new Set(["i", "m", "s", "x", "U", "-", "^"]);

/** True when the `(?…` group at `index` is a Rust-`regex` inline-flags group. */
function isFlagGroup(pattern: string, index: number): boolean {
  // index points at '(' and pattern[index + 1] === '?'. Accept (?flags),
  // (?flags:…): every char up to the first ')' or ':' must be a flag char
  // and at least one flag char must be present.
  let seenFlag = false;
  for (let i = index + 2; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === ")" || char === ":") return seenFlag;
    if (char !== undefined && FLAG_CHARS.has(char)) {
      seenFlag = true;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Reject regex constructs outside the Rust `regex` crate's syntax
 * (AC-12.6): lookaround (`(?=`, `(?!`, `(?<=`, `(?<!`), backreferences
 * (`\1`–`\9`, `\k<name>`, `\g…`). A small scanner — not a regex-on-a-regex —
 * tracking backslash escapes and `[…]` class depth, so `\(?=` and `[(?=]`
 * are not false positives. Constructs legal in `regex` but absent from JS
 * (`(?i)`, `\p{…}`, `(?:…)`, named groups) are accepted.
 */
export function assertSupportedRegex(pattern: string): void {
  let classDepth = 0;
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) return;
      if (next >= "1" && next <= "9") unsupported("backreference", pattern);
      if (next === "k" && pattern[i + 2] === "<") unsupported("backreference", pattern);
      if (next === "g") unsupported("backreference", pattern);
      i += 2;
      continue;
    }
    if (char === "[") {
      // A `\[` above already skipped escapes; a `[]` pair cannot open-then-
      // close here in a way that matters for group tracking — depth alone
      // keeps `[(?=]` from false-positiving.
      classDepth += 1;
      i += 1;
      continue;
    }
    if (char === "]") {
      if (classDepth > 0) classDepth -= 1;
      i += 1;
      continue;
    }
    if (char === "(" && classDepth === 0) {
      const next = pattern[i + 1];
      if (next !== "?") {
        i += 1;
        continue;
      }
      const rest = pattern.slice(i);
      if (rest.startsWith("(?=") || rest.startsWith("(?!")) unsupported("lookaround", pattern);
      if (rest.startsWith("(?<=") || rest.startsWith("(?<!")) unsupported("lookaround", pattern);
      if (rest.startsWith("(?:")) {
        i += 3;
        continue;
      }
      if (rest.startsWith("(?P<") || rest.startsWith("(?<")) {
        i += rest.startsWith("(?P<") ? 4 : 3;
        continue;
      }
      if (rest.startsWith("(?#")) {
        i += 3;
        continue;
      }
      if (isFlagGroup(pattern, i)) {
        i += 2;
        continue;
      }
      unsupported("group construct", pattern);
    }
    i += 1;
  }
}

function isExtglobPrefix(glob: string, index: number): boolean {
  const char = glob[index];
  const next = glob[index + 1];
  return (
    (char === "?" || char === "*" || char === "+" || char === "@" || char === "!") && next === "("
  );
}

/**
 * Reject glob constructs outside the globset intersection subset (AC-12.6):
 * extglob (`?(`, `*(`, `+(`, `@(`, `!(`), regex groups (bare parens),
 * leading-`!` negation, `**` outside a whole segment, and unclosed `[…]` /
 * `{…}`. Accepted: literals, `?`, `*`, `**` (whole segment only), `[…]`
 * classes with `!`/`^` negation, `{a,b}` alternation, `\` escapes.
 */
export function assertSupportedGlob(glob: string): void {
  if (glob.length === 0) unsupported("empty glob", glob);
  if (glob.startsWith("!")) unsupported("negation", glob);
  let classDepth = 0;
  let braceDepth = 0;
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === "\\") {
      if (i + 1 >= glob.length) unsupported("trailing escape", glob);
      i += 2;
      continue;
    }
    if (classDepth > 0) {
      if (char === "]") classDepth -= 1;
      i += 1;
      continue;
    }
    if (char === "[") {
      classDepth += 1;
      i += 1;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (char === "}") {
      if (braceDepth === 0) unsupported("unbalanced brace", glob);
      braceDepth -= 1;
      i += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      if (i > 0 && isExtglobPrefix(glob, i - 1)) unsupported("extglob", glob);
      unsupported("group", glob);
    }
    i += 1;
  }
  if (classDepth > 0) unsupported("unclosed class", glob);
  if (braceDepth > 0) unsupported("unclosed brace", glob);
  for (const segment of glob.split("/")) {
    if (segment.includes("**") && segment !== "**") unsupported("inline double-star", glob);
  }
}

function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * Clause 3 of the canonicalization contract, shared by LRN-13 and LRN-30's
 * contract suite so each does not invent one: both inputs must already be OS-
 * canonicalized (fully resolved, absolute, stored-spelling). Comparison is
 * byte-exact — no case folding, no NFC/NFD normalization. A path is inside
 * the root iff it equals the root or the root plus `/` prefixes it, so
 * `/root-evil` is not inside `/root`. A case-variant or NFD variant of a
 * contained path is NOT inside by this definition: the OS canonicalizer
 * already collapses those to the stored spelling before this runs, and
 * folding again here would fork Node and Rust equality.
 */
export function isInsideRoot(canonicalRoot: string, canonicalPath: string): boolean {
  const root = stripTrailingSlash(canonicalRoot);
  const path = stripTrailingSlash(canonicalPath);
  if (!root.startsWith("/") || !path.startsWith("/")) return false;
  if (path === root) return true;
  if (root === "/") return true;
  return path.startsWith(`${root}/`);
}
