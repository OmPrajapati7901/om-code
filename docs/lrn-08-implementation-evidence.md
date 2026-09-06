# LRN-08 implementation evidence

Verified on 2026-09-06 on macOS arm64 with Node 24.20.0 (project pin) and Node 26.8.1 (active
shell), pnpm 11.25.0. This is not an M1 milestone completion claim: LRN-09 through LRN-11 still
supply prompt assembly, the turn loop and the CLI.

## What landed

- `packages/providers/src/fake.ts` — `FakeProvider`, a scripted `ModelProvider` double. It builds
  the same OpenAI-compatible wire chunks the real endpoint would send and replays them through
  the adapter's own `ResponseProjection` (`packages/providers/src/projection.ts`), so fake events
  and terminal responses share the adapter's shape instead of a second hand-rolled accumulator.
  Scripts are turn sequences (`FakeScript.turns`); a turn can be a single attempt or a list where
  every non-final `http-error` attempt with a retriable status (429 or ≥500) is absorbed before
  the next attempt runs, rendering "429 then success" faithfully. No `Date.now`, `Math.random`,
  `setTimeout` or `performance.now` anywhere in the file — a source-grep test in
  `packages/providers/tests/fake.test.ts` asserts this, and a determinism test asserts two fresh
  instances given the same script produce byte-identical event sequences.
- `packages/providers/src/recorder.ts` — `recordingFetch()`, a pure `fetch` wrapper. It `tee()`s
  the response body so the caller's own stream is unaffected, accumulates the captured branch,
  and redacts it (exact-literal replacement via the adapter's existing `sanitize()` from
  `guards.ts`, plus pattern scrubbing for `sk-…`, `gsk_…`, `Bearer …`, and
  `"authorization": "…"`). No `node:fs` — the existing `tests/boundaries.test.ts` rule that
  `packages/providers` performs no direct file/process I/O still holds unmodified.
- `tests/manual/record-fixture.mjs` — the paid, explicit capture script
  (`node --env-file=.env tests/manual/record-fixture.mjs <name>`) that runs one text and one tool
  request against the configured endpoint through `recordingFetch`, asserts the capture is
  credential-free, and writes `packages/providers/tests/fixtures/<name>-{text,tool}.sse`. Not run
  as part of this evidence pass (it spends real credits); it mirrors the existing
  `provider-smoke.mjs` pattern and reuses the same env vars.
- `tests/guards/no-network.mjs` — the suite-level socket guard (AC-8.5). Plain ESM so one file
  works both as a vitest `setupFiles` entry and as `node --import` for spawned children. It
  patches `fetch`, `net.connect`/`net.createConnection`/`net.Socket.prototype.connect`,
  `tls.connect`, and `dns.{lookup,resolve,resolve4,resolve6}` (both sync and `.promises`) to
  throw **and record** the attempt, so a caller that swallows the throw still fails the file via
  an `afterEach` hook. It detects an actual vitest worker via `globalThis.__vitest_worker__`, not
  `process.env.VITEST` — the latter is inherited by every spawned child (including the
  journal-process fixtures below), which are plain node processes with no real vitest runtime to
  register `afterEach` against; using the env var crashed those children outright during
  development (see "one bug found" below). Every package's `vitest.config.ts` and the root
  `tests/vitest.config.ts` load it via `setupFiles`. `packages/storage`'s
  `journal-process.test.ts` additionally passes it to its spawned children via
  `node --import <guard>`, since `setupFiles` covers only the vitest worker itself.
- Scenario wiring for the fake: `tests/contract/fake-fixtures.ts` maps the six
  `ProviderScenario`s to `FakeScript`s, mirroring the existing `adapter-fixtures.ts` pattern for
  the real adapter. `tests/fake-provider-contract.test.ts` runs the **same**
  `providerContract()` suite from `tests/contract/provider.ts` against it, unchanged.

## Scope and honesty notes

- The guard's coverage is the vitest workers plus the node children our own tests spawn
  (`packages/storage`'s journal-process fixtures, via explicit `--import`). It does **not** cover
  `pnpm`/`tsc` child processes spawned by build tooling (e.g. `packages/cli`'s `bin.test.ts`,
  which shells out to `pnpm run build`) — that is stated as scope, not claimed as covered.
- No loopback exception exists anywhere in the guard, matching the note already recorded in the
  backlog before this task started. `tests/manual/*.mjs` commands run under bare `node`, entirely
  outside every guard, for the explicit paid/loopback checks that need real transport.
- The fake reuses `ResponseProjection` rather than independently re-deriving accumulation. This
  keeps the double behaviorally identical to the adapter for a fraction of the code, but means
  its correctness is not an independent cross-check of the projection logic — that already has
  its own coverage from `packages/providers/tests/provider.test.ts`'s 48 tests.

## One bug found during implementation

`tests/guards/no-network.mjs` originally gated its `vitest`-specific `afterEach` registration on
`process.env.VITEST`. Every `node --import`ed child spawned from inside a vitest test inherits
that env var from its parent even though it has no real vitest runtime, so the child attempted
`await import("vitest")` and called an API (`getWorkerState`) that throws outside an actual
worker — crashing the child before it reached its own logic. This surfaced as
`packages/storage`'s `journal-process.test.ts` failing all six of its tests ("holder exited
before ready", `signalCode` `null` instead of `SIGKILL`) once its spawned children were given
`--import <guard>`. Fixed by detecting `globalThis.__vitest_worker__` (an in-process global, not
inherited by a spawned child) instead of the env var.

## Full gate

```sh
pnpm run check
```

Lint (Biome), typecheck, build and test all green: **279 tests passed, 1 skipped** (the
optional real-keychain test from LRN-04), across protocol (90), providers (61: 48 existing +
8 fake + 5 recorder), session (2), storage (58, 1 skipped), root `tests` (30, including the new
7-test `network-guard.test.ts` and 6-test `fake-provider-contract.test.ts`), and cli (37).

Independently reproduced offline, matching the LRN-06/07 evidence doc's method:

```sh
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /usr/bin/time -p /usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*)' pnpm run check
```

Result: green, 36.95s real time, with the OS itself denying all network access — not merely the
guard's own claim.

**The guard is load-bearing, not decorative.** A planted violation
(`await fetch("https://example.com")` added temporarily to a `packages/providers` test) failed
the run with `network access blocked by test guard: fetch (https://example.com)` from the direct
throw, and a second, redundant failure from the `afterEach` check — confirming both the immediate
throw path and the swallowed-throw recording path actually fire. The planted line was reverted
and the full gate re-confirmed green afterward.

`tests/network-guard.test.ts` additionally covers the failure path directly: a spawned child
(`tests/guards/fixtures/violation-child.mjs`) that swallows the guard's throw in a `try/catch`
still exits non-zero via the guard's `process.on("exit", …)` fallback, and a clean child
(`clean-child.mjs`) with no network access exits zero — proving AC-8.5's "fails the test run"
claim for both in-process and spawned-child violations, not just the in-process case.

## Known pre-existing flake (not introduced by this task)

`packages/providers/tests/provider.test.ts`'s `"aborts retry backoff without another transport
request"` test (LRN-07d/AC-7.6-adjacent, not touched by this task) uses `vi.useFakeTimers()` with
an unmocked `Math.random()` inside `retryDelay()`'s jitter calculation, and advances fake timers
by a fixed 100ms before asserting only one transport attempt occurred. Because the real backoff
window for a 503 at attempt 0 is `500ms * random()`, roughly a quarter of runs draw a delay under
100ms and the assertion sees two calls instead of one. Reproduced on unmodified `main` (confirmed
via `git stash` before re-applying this task's changes) and confirmed flaky in isolation (2 of 6
repeated single-test runs failed) — independent of every change in this task. Left unfixed as
out of scope for LRN-08; worth a follow-up task to mock `Math.random` in that specific test.
