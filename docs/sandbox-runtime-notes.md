# Sandbox-runtime spike (LRN-13b)

One-evening, throwaway probe of `@anthropic-ai/sandbox-runtime` **0.0.75**
(resolved 2026-09-07; `0.0.x` with documented config churn, so this answer
has a shelf life — re-run on any upgrade). Throwaway script and `node_modules`
lived outside the repo and were deleted; only this note is committed
(AC-13b.5). Host: macOS arm64, Seatbelt path.

## AC-13b.1 — long-lived child: YES

The API is per-command string assembly, not a process handle:
`wrapWithSandbox(command, binShell?, config?, signal?, { commandId })`
returns a **string** (`Promise<string>`) that the caller spawns itself
(README: `spawn(sandboxedCommand, { shell: true })`). There is no API that
takes over a persistent `ChildProcess`.

That still covers the stub: wrap **once** at stub spawn, keep the child.
Observed, with `node -e '…stdin echo loop…'` wrapped and spawned with piped
stdio:

- `WRITE_DENIED:EPERM` — the persistent child's write to a `denyWrite` dir
  was denied, so enforcement applies to the long-lived child, not just
  one-shots.
- The child answered on stdin across a 1.5 s idle gap (`echo:ping1`,
  `echo:ping2`) and exited 0 on `quit`.

Lifecycle mapping for LRN-33: one stub lifetime = one wrapped invocation =
one `commandId` (violation attribution keys on it; keys compare on the first
100 chars, so use an opaque id, not command text). Call
`cleanupAfterCommand()` once at stub teardown, not per tool call; `reset()`
tears down the manager (proxy servers started by `initialize`).

## AC-13b.2 — generated profile text: embedded, no dedicated accessor

- Zero profile-ish package exports; `generateSandboxProfile` is
  module-private; `getConfig()` returns only the *input*
  `SandboxRuntimeConfig`.
- But the returned command string embeds the profile verbatim:
  `… /usr/bin/sandbox-exec -p '<1621 chars of SBPL>' bash -c '…'`
  (observed length 14982 for the whole wrapped string). First lines:
  `(version 1)`, `(deny default (with message "CMD64_…_END__…"))`.
- So the profile in force is recoverable by extracting the `-p '…'` operand
  (shell-unquoting it) — scraping, not an API. Any quoting change breaks the
  extractor, so pin the version and test the extraction.
- Profiles differ per invocation by design: the deny message and `LogTag`
  comment embed the per-`commandId` tag (`CMD64_…`). Host verification for
  AC-33.4 must normalize those lines before comparing.

## Sentence

**GO, conditional:** wrap once per stub lifetime for the persistent process
(demonstrated above, enforcement confirmed), and report the in-force profile
in `health` by extracting the `-p` operand from the wrapped string with a
test pinning the extraction — pinned at exactly `0.0.75`, re-run this spike
on upgrade; if extraction ever breaks, the fallback is generating the `.sb`
profile ourselves and invoking `/usr/bin/sandbox-exec` directly (~100–150
lines; `codex-rs/sandboxing` is Apache-2.0 prior art), which the placement
port already makes a driver swap.

## Also noted for later

- `isSupportedPlatform()` / `isSandboxingEnabled()` / `checkDependencies()`
  exist — natural `om doctor` material (AC-35.x).
- `annotateStderrWithSandboxFailures(commandId, stderr)` /
  `getViolationsForCommand(commandId)` are the violation-reporting path.
