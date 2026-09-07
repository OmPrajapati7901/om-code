# om-code — Execution Backlog (Solo, macOS)

**Source plan:** [om-code-master-delivery-blueprint.md](docs/om-code-master-delivery-blueprint.md) (`LR-FR-*`, `LR-NFR-*`) · [coding-agent-harness-final-architecture.md](docs/coding-agent-harness-final-architecture.md)
**Scope authority:** [ADR-023](docs/adr/ADR-023-macos-openai-compatible-learning-scope.md) — macOS arm64, one OpenAI-compatible endpoint, one developer
**Replaces:** the 102-task multi-agent backlog, archived at `docs/architecture/archive/2026-09-05-production-plan/` under ADR-023

**49 tasks, five milestones, 238 acceptance criteria.** Every milestone ends with something you can
run and feel. Acceptance criteria for a task sit directly under its row in the same table section —
read them before you start the task, not after.

**Notation.** `AC-n.m` is criterion *m* of task LRN-*n*. **MUST** criteria block the task — the task is
not `completed` until all of them pass. **SHOULD** criteria are recorded as a follow-up issue if
skipped, never silently dropped. "Rejects" lists behaviour that must be *impossible*, proven by a
failing-case test, not just absent from the happy path.

---

## How to use this

**Go top to bottom.** Nothing depends on anything below it.

**Core vs Harden.** `Core` tasks are the product — skip one and it doesn't work. `Harden` tasks are
what make it trustworthy rather than a toy. On a first pass through a milestone you may do the Core
tasks and come back for Harden, **except in M4, which is all Harden by design and is not optional
before you stop reading diffs.**

**Sizes** are honest: `S` = an evening · `M` = a weekend · `L` = a couple of weekends. If an `L` task
stalls twice, split it and write down what the two halves are.

**One task per branch**, `feat/<kebab-name>`, commit `type(scope): summary (LRN-NN)`. Before merging,
run the Universal Definition of Done (§DoD below) and the blueprint §12 self-review checklist.

**Status** on every task row: `todo` (not started), `half completed` (started but not yet verified
done), or `completed` (done *and* every MUST criterion under it holds). Leave `Comments` empty while a
task is `todo`; fill it in only when you change the status — say what is left (`half completed`) or
what the evidence was (`completed`). Keep it honest; a task only becomes `completed` when the
observable is actually demonstrated, not when the code compiles.

**If you only ever finish M1–M3, you have a working coding agent.** M4 is what makes it safe to trust
and M5 is what makes it pleasant. That is the honest order of value.

---

## Universal Definition of Done

Applies to **every** task, no exceptions — including ones that feel trivial.

| # | Gate | Check |
|---|---|---|
| **DoD-1** | Every MUST criterion for the task passes | Named test exists and is green |
| **DoD-2** | The failure path is tested, not just the happy path | At least one test asserting the documented failure behaviour |
| **DoD-3** | `pnpm biome check`, `tsc --noEmit`, `dependency-cruiser` all clean | CI green on the branch. `dependency-cruiser` does not exist until LRN-14 and CI until LRN-15; before those land, this gate means the checks that exist, run locally |
| **DoD-4** | The whole suite runs **offline** and completes | No network access in any test; suite under 3 min |
| **DoD-5** | No new production filesystem/process access outside `stub-client`, `storage`, `native/`; trusted provider HTTP is allowed | Boundary lint green (from LRN-14 onward) |
| **DoD-6** | New behaviour-affecting state is journaled, not held in a module variable | Self-review question 4 |
| **DoD-7** | Commit message is `type(scope): summary (LRN-NN)` and the body carries evidence for any number or security claim | `git log` |
| **DoD-8** | Anything you learned that contradicts the plan is written back into the blueprint in the same commit | Diff includes the doc change |

**Milestone DoD:** the milestone's exit gate has been **demonstrated from a terminal and the transcript
pasted into the merge commit.** A milestone is not done because its tasks are done.

---

## The one thing to check before you build anything

**LRN-01 is a spike, and it is the highest-value task in this document.** Everything here assumes your
OpenAI-compatible endpoint does streaming tool calls correctly. Many do not: they drop `tool_calls`
deltas, emit arguments as a single blob, return no `usage`, or hallucinate the schema. If that is true
of your endpoint, you will spend weeks thinking your code is broken.

Find out in one evening, before you write a line of the product.

---

## M1 — "It talks" · *a journaled conversation with a real model*

**You will have:** `om run` holds a real multi-turn conversation against your endpoint, streams
answers, writes a journal, and `om show` reads it back. No tools yet.

| # | Task | Type | Size | Depends | Req | Done when | Status | Comments |
|---|---|---|---|---|---|---|---|---|
| **LRN-01** | **Endpoint spike.** A 100-line throwaway script: stream a chat completion from your endpoint, then stream one that must call a tool. Record what the deltas actually look like, whether `usage` comes back, and how arguments arrive | Core | S | — | LR-FR-014 | You have written down, in `docs/endpoint-notes.md`, exactly what your endpoint does. **Throw the script away** | completed | Groq spike run 2026-09-05 (`qwen/qwen3.8-27b`): `docs/endpoint-notes.md` written, GO verdict, spike script deleted per AC-1.6 (raw captures kept untracked in `tmp/` for LRN-07c). Committed in LRN-02 init commit; `docs/endpoint-notes.md` present, no source added, spike script deleted per AC-1.6 (raw captures untracked in `tmp/` for LRN-07c). |
| **LRN-02** | `git init`, `.gitignore` (`node_modules`, `target`, `runs/`, `.om-code/`, `*.tsbuildinfo`), commit the planning docs | Core | S | — | §16.1 | `git log` shows one commit containing the plan | completed | Single init commit holds all four planning documents; `.gitignore` covers AC-2.2 patterns; `git status` clean; `.env` and `tmp/` raw captures untracked. |
| **LRN-03** | pnpm workspace, `tsconfig.base.json` (strict, ESM, NodeNext), `biome.json`, `.tool-versions` (Node 24), and a `bin` entry so **`om` runs from your shell** | Core | S | 02 | §16.2 | `pnpm install && om --version` works in a new terminal. No Cargo yet — that arrives in M4 | completed | 25 tests green in 0.8 s (`packages/cli/tests/{platform,cli,bin}.test.ts`); `pnpm run check` (lint, typecheck, build, test) green in 3 s. AC-3.1 verified in a clean tree materialized from the git index: `pnpm install --frozen-lockfile` in 1.1 s, full gate green, binary runs. `om --version` prints `0.1.0` from a scrubbed fresh login shell (`env -i … zsh -l -i`) outside the repo. `pnpm link --global` no longer exists in pnpm 11 — used `pnpm add --global ./packages/cli`, which needed a one-time `pnpm setup` to put `~/Library/pnpm/bin` on PATH. `.tool-versions` pins `nodejs 24.20.0` per plan but is declarative (no asdf/mise installed); `engines.node` is `>=24` and the binary was verified under both 24.20.0 and the shell's active 26.8.1. Platform guard (AC-3.4) runs before command dispatch and is tested against six unsupported hosts. `dependency-cruiser` deferred to LRN-14 per the DoD-3 note above. |
| **LRN-04** | **Config.** `~/.om-code/config.json` + env overrides for base URL, model id and credential reference. Credential is read from env or keychain, never written to disk by us | Core | S | 03 | LR-FR-036 | `om config print --effective --with-sources` shows which value came from where | completed | `pnpm run check` green: 69 tests pass, 1 skipped (real-keychain probe). Precedence flags > env > project > user > defaults in one loader (`packages/storage`); credential resolves via `env:`/`keychain:` with a redacting wrapper; empty config exits 1 with remediation, malformed JSON exits 1 with file/field/shape and no stack — all demonstrated from the terminal. |
| **LRN-05** | `packages/protocol`: Zod schemas for the journal envelope and every `Entry` kind, `SessionMeta`, `Usage`, `CapabilityRequest`, with `schemaVersion` per kind | Core | M | 03 | LR-FR-001 | Each schema has a valid and an invalid parse test. Flag anything ambiguous in the commit body instead of guessing | completed | `pnpm run check` green: 83 protocol tests (6 files) + full suite (storage 32 passed/1 skipped, cli 37 passed). AC-5.5 demonstrated from the terminal against `dist/` (unknown kind preserved verbatim; v99 `user_message` rejected naming kind/seen/supported). Completeness test verified self-enforcing by deleting a kind and observing the failure. Ambiguities listed in the commit body per AC-5.7. |
| **LRN-06** | `packages/storage`: journal append (monotonic `seq`, `sha256` per record, `fsync` at commit points you choose **and document**, an advisory per-session write lock) and read-back | Core | M | 05 | LR-FR-002 | Property test: append → read → materialize is stable over random entry sequences | completed | Journal/native-lock/recovery/property acceptance passed on macOS arm64 Node 24; committed in `e13d130` (DoD-7 satisfied). See [evidence](lrn-06-07-implementation-evidence.md). |
| **LRN-07a** | `packages/protocol`: define the `ModelProvider` port; `packages/providers` implements it (`stream(request, signal)` → async iterable of typed events) and the OpenAI-compatible adapter's plain-text streaming path, using what LRN-01 taught you | Core | M | 04, 05 | LR-FR-014 | A multi-token text completion streams as more than one delta — not buffered whole — and a grep lint over `packages/providers` asserts nothing branches on the model name | completed | Shared port/contracts, incremental text, source branch guard and live text smoke passed; committed in `e13d130` against a LangChain-based transport (DoD-7 satisfied), then the transport itself was reverted to hand-rolled `fetch`+SSE in `83d4aa8` per [ADR-024](adr/ADR-024-no-langchain.md) with the same port and behavior preserved (252 tests, 6-scenario contract). See [evidence](lrn-06-07-implementation-evidence.md) and its 2026-09-06 amendment. |
| **LRN-07b** | Usage and retry semantics: `usage` passed through when the endpoint reports it, `unknown` when it doesn't (never zero, never estimated); retry only on 429/5xx with exponential backoff and a cap; any other 4xx fails immediately | Core | S | 06, 07a | LR-FR-014 | Contract tests over recorded fixtures assert unknown-usage and retry-only-on-429/5xx | completed | Late/unknown/zero usage, bounded HTTP-only retries and journal integration passed; committed in `e13d130` (DoD-7 satisfied). Retry/backoff moved from a delegated SDK option back to this package's own `retryDelay`/`sleep` in `83d4aa8`; same 429/5xx-only, maxRetries-bounded behavior, re-verified. See [evidence](lrn-06-07-implementation-evidence.md). |
| **LRN-07c** | Tool-call delta accumulation: assemble streamed `tool_calls` fragments into complete calls, using the exact shape LRN-01 observed on your endpoint | Core | M | 07a | LR-FR-014 | A fixture reproduces your endpoint's real tool-call delta shape and accumulates it correctly | completed | Recorded Groq shape, synthetic interleaving/raw arguments and forced-tool live smoke passed; committed in `e13d130` (DoD-7 satisfied). See [evidence](lrn-06-07-implementation-evidence.md). |
| **LRN-07d** | Disconnect and cancellation: a mid-stream disconnect yields a typed error and a journaled partial assistant message; `signal` abort stops the stream and closes the connection within 1 s | Core | S | 07a, 07b, 07c | LR-FR-014 | A forced mid-stream disconnect and a forced abort each behave as specified, tested against both the text and tool-call paths | completed | Text/tool interruption journaling, timeout/abort cleanup and real socket-close checks passed; committed in `e13d130` (DoD-7 satisfied). Re-verified against the hand-rolled transport in `83d4aa8`: loopback socket close 5 ms text / 0 ms tool, matching the original 6 ms / 0 ms. See [evidence](lrn-06-07-implementation-evidence.md). |
| **LRN-08** | Fake provider replaying scripted turns — including tool calls, malformed arguments and truncated streams — plus a recorder that saves real traffic to fixtures with credentials stripped | Core | M | 07d | LR-FR-004 | The whole suite runs with no network and no credentials | completed | `FakeProvider`/`recordingFetch` land in `packages/providers`; scenario scripts live in `tests/contract/fake-fixtures.ts` and pass the existing shared contract suite unchanged. Guard evidence in [lrn-08-implementation-evidence.md](lrn-08-implementation-evidence.md). |
| **LRN-09** | **The prompt.** System prompt assembly: identity, the rules the model must follow, environment facts (cwd, OS, date), instruction files, and the tool schemas once they exist. One module, one snapshot test | Core | M | 05 | LR-FR-037 | A snapshot test shows the exact assembled prompt. **This is the file you will edit most often — make it easy to read** | completed | New `packages/kernel` (`assemblePrompt`, AC-9.1–9.6 all green); a `prompt` journal entry kind (protocol's 11th) carries instruction-file hashes for AC-9.5; tool-call/result interleaving is out of scope until LRN-18 and throws naming it; `tests/boundaries.test.ts` carries the AC-9.1 grep lint. Evidence: `pnpm --filter @om-code/kernel test` (12/12) and `pnpm run check` green. |
| **LRN-10** | `packages/kernel`: the turn loop — assemble → infer → stream → journal → yield. No tools yet. Every transition journaled | Core | M | 06, 07d, 09 | LR-FR-019 | A completed turn is fully reconstructable from its journal | completed | Explicit typed states/transitions, async streamed turn events, append-before-effect ordering, durable provider/local errors, partial interruption handling, and real JournalWriter readback/materialization landed. AC-10.5's dependency-cruiser assertion is deferred to LRN-14 under DoD-3; the interim boundary test bans provider/storage/sandbox/stub-client dependencies (including devDependencies) and self-checks a planted violation. Evidence: `pnpm --filter @om-code/kernel test` (20/20), `pnpm --filter @om-code/tests test` (36/36), and `pnpm run check` green. |
| **LRN-11** | `packages/cli`: `om run` **interactive (a real multi-turn REPL) and `-p` one-shot**, streamed output, `om sessions`, `om show <id>`, and the exit-code contract 0/1/2/3/4 | Core | M | 10 | LR-FR-005 | **`om run` holds a multi-turn conversation against your real endpoint and leaves a journal you can read.** Codes 0/1/3 are tested here; 2 and 4 cannot exist until policy (LRN-21a–d, LRN-22) and are tested there | todo | — |

### Acceptance criteria — M1

**LRN-01 — Endpoint spike** *(Throwaway code)*
- **AC-1.1 (MUST)** A non-tool streaming completion is received from the configured endpoint, and the raw SSE/chunk shape is captured verbatim into `docs/endpoint-notes.md`.
- **AC-1.2 (MUST)** A completion that **must** call a tool is attempted, and the notes record: whether `tool_calls` arrive as deltas or one blob; whether `arguments` is valid JSON on arrival or must be accumulated; whether an index/id correlates the fragments.
- **AC-1.3 (MUST)** The notes state whether `usage` is returned, and on which chunk (final only, or per chunk, or never).
- **AC-1.4 (MUST)** The notes state what happens on two failure paths you deliberately trigger: an invalid model id, and a mid-stream disconnect.
- **AC-1.5 (MUST)** A **go / no-go** sentence is written: if tool calling is unreliable on this endpoint, name the fallback endpoint you will use instead. Discovering this in M3 is the failure this task exists to prevent.
- **AC-1.6 (MUST)** The spike script is **deleted**, not merged.
- **Completion:** `docs/endpoint-notes.md` committed; no source code added.

**LRN-02 — Repository initialization**
- **AC-2.1 (MUST)** `git log` shows one commit containing all four planning documents.
- **AC-2.2 (MUST)** `.gitignore` covers `node_modules`, `target`, `runs/`, `.om-code/`, `*.tsbuildinfo`, `.env*`.
- **AC-2.3 (MUST)** `git status` is clean immediately after the commit.

**LRN-03 — Workspace scaffold**
- **AC-3.1 (MUST)** `pnpm install` succeeds from a clean clone on macOS arm64.
- **AC-3.2 (MUST)** `tsconfig.base.json` sets `strict: true`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2023`, `noUncheckedIndexedAccess: true`.
- **AC-3.3 (MUST)** `om --version` runs **in a new terminal** after `pnpm link` (or equivalent) and prints the version from `package.json`.
- **AC-3.4 (MUST)** `om` on a **non-macOS or non-arm64 host** exits 1 with a message naming the unsupported platform — the LR-FR-019 startup guard.
- **AC-3.5 (MUST)** No Cargo workspace exists yet. Rust arrives in M4.
- **Rejects:** a build that silently proceeds on an unsupported platform.

**LRN-04 — Configuration**
- **AC-4.1 (MUST)** Settings resolve through **one** loader, in precedence order: session flags > project `.om-code/settings.json` > user `~/.om-code/config.json` > defaults.
- **AC-4.2 (MUST)** `om config print --effective --with-sources` prints each resolved value **with the file or flag it came from**.
- **AC-4.3 (MUST)** The credential is read from an environment variable or the macOS keychain. **A test asserts the credential value never appears in any file we write**, including config, journal and logs.
- **AC-4.4 (MUST)** A malformed config file produces a message naming the file, the field and the expected shape — never a stack trace.
- **AC-4.5 (MUST)** Missing required config (base URL or model) fails at startup with remediation text, not at first inference.
- **AC-4.6 (MUST)** A tier-precedence test covers: value only in user tier; overridden by project; overridden again by flag.
- **Rejects:** writing a credential to disk; a config error surfacing as an unhandled exception.

**LRN-05 — Protocol schemas**
- **AC-5.1 (MUST)** Zod schemas exist for the journal envelope and **every** `Entry` kind in blueprint §7, plus `SessionMeta`, `Usage`, `CapabilityRequest`, `ToolStatus`.
- **AC-5.2 (MUST)** Each schema has a valid-parse test and an invalid-parse test asserting the specific error.
- **AC-5.3 (MUST)** `ToolStatus` includes `unknown`. A test asserts it is representable and round-trips.
- **AC-5.4 (MUST)** Each entry kind carries `schemaVersion`.
- **AC-5.5 (MUST)** Reading a record with an **unrecognized entry kind** preserves it verbatim rather than dropping or rejecting it; reading an **unknown `schemaVersion`** produces a clear typed error naming the version.
- **AC-5.6 (MUST)** `packages/protocol` imports nothing from any other workspace package — asserted by `dependency-cruiser`.
- **AC-5.7 (SHOULD)** Ambiguities found while writing schemas are listed in the commit body rather than resolved silently.

**LRN-06/07 implementation decisions (2026-09-06).** Full verification and every-append
fsync replace tail-only verification/selective commits. The user approved an early native
storage lock; its permanent inode is never unlinked, and process death releases it. Repair
preserves the original and atomically publishes a verified prefix plus a repair entry. Only
unterminated final fragments qualify; terminated corruption and incompatible schemas block
writing. Reader diagnostics come from `readAll()`. Pure materialization lives in `session`;
model ports/errors in `protocol`; integration and shared contract factories in root `tests/`.
Assistant schema v2 stores raw calls and explicit interruption, retaining v1 readers. LRN-08
reuses `tests/contract/provider.ts`; HTTP mechanics stay adapter-local. Its socket guard still
has no loopback exception: `tests/manual/` commands are separate explicit acceptance actions.
See [evidence and APIs](lrn-06-07-implementation-evidence.md). No M1 CLI completion is implied.

**LRN-06 — Journal**
- **AC-6.1 (MUST)** Append assigns strictly increasing `seq` starting at 1, with no gaps, per session.
- **AC-6.2 (MUST)** Each record carries `sha256` over its `entry`; a record whose hash does not verify is treated as corrupt on read.
- **AC-6.3 (MUST)** `fsync` points are **documented in the module header** with the reasoning, and a test asserts a flush occurs at each documented point.
- **AC-6.4 (MUST)** Property test: for random valid entry sequences, `append*` → `read` → `materialize` yields the same result twice and preserves order.
- **AC-6.5 (MUST)** An advisory lock permits **one writer per session file**. A second writer fails immediately with a message naming the recorded holding process (or explicitly indicating metadata initialization) — it does not block indefinitely and does not interleave.
- **AC-6.6 (MUST)** The journal path is under `~/.om-code/sessions/<project-hash>/` and is created with `0700`.
- **Rejects:** two processes appending to one session file; a silently reordered `seq`.

**LRN-07a — Provider port and text streaming**
- **AC-7.1 (MUST)** A `ModelProvider` port is defined with `stream(request, signal)` returning an async iterable of typed events; the OpenAI-compatible adapter implements it.
- **AC-7.2 (MUST)** Text deltas stream incrementally — a test asserts more than one delta is observed for a multi-token response, i.e. the response is not buffered whole.
- **AC-7.5 (MUST)** Nothing branches on the model name string. Asserted by a grep lint over `packages/providers`.
- **Rejects:** inferring any capability from the model name.

**LRN-07b — Usage and retry semantics**
- **AC-7.4 (MUST)** When the endpoint reports no `usage`, usage is `unknown` — **never zero, never estimated**. A test asserts this distinction survives into the journal.
- **AC-7.6 (MUST)** Retry occurs **only** on 429 and 5xx, with exponential backoff and a cap; 4xx other than 429 fails immediately with the endpoint's message.
- **Rejects:** reporting usage `0` when the endpoint sent none.

**LRN-07c — Tool-call accumulation**
- **AC-7.3 (MUST)** Tool-call deltas are accumulated into complete calls **using the shape LRN-01 actually observed**, and a fixture reproduces that shape.

**LRN-07d — Disconnect and cancellation**
- **AC-7.7 (MUST)** A mid-stream disconnect produces a typed error and a journaled partial assistant message — not a hang and not a silent truncation.
- **AC-7.8 (MUST)** `signal` abort stops the stream and closes the connection within 1 s.
- **Completion:** both paths are exercised against **text and tool-call** streams, so cancellation is proven on the path LRN-07c added, not only the simple one.

**LRN-08 — Fake provider and recorder**
- **AC-8.1 (MUST)** The fake provider implements the **same** `ModelProvider` port and passes the **same** contract test suite as the real adapter.
- **AC-8.2 (MUST)** It can script: plain text, a single tool call, parallel tool calls, malformed JSON arguments, a truncated stream, and a 429 followed by success.
- **AC-8.3 (MUST)** Given the same script, output is byte-identical across runs.
- **AC-8.4 (MUST)** The recorder captures real traffic to a fixture **with the credential stripped**, verified by a test that greps the fixture for the key pattern.
- **AC-8.5 (MUST)** A suite-level guard fails the test run if any test process opens a network socket. This is what makes LR-NFR-006 real rather than aspirational.
- **Rejects:** a fake that diverges from the port; a fixture containing a credential.

**LRN-09 — Prompt assembly**
- **AC-9.1 (MUST)** One module assembles the request. A lint asserts **no other module** appends to the system prompt.
- **AC-9.2 (MUST)** The assembled prompt contains, in a stated order: identity and rules, environment facts (cwd, OS, date), instruction files, conversation, tool schemas.
- **AC-9.3 (MUST)** A snapshot test pins the exact assembled prompt for a fixed session; the diff is readable when it changes.
- **AC-9.4 (MUST)** Assembly is a pure function of the session snapshot plus config — no clock or filesystem reads inside it (the date is passed in), so the snapshot is stable.
- **AC-9.5 (MUST)** Instruction-file content enters by reference to its content hash, and the hash is journaled.
- **AC-9.6 (SHOULD)** The prompt file carries a comment explaining *why* each rule is there, so you can delete rules later with confidence.

**LRN-10 — Turn loop**
- **AC-10.1 (MUST)** States and legal transitions are explicit; an illegal transition is a **type error**, not a runtime check.
- **AC-10.2 (MUST)** Every state transition appends a journal record before the side effect it describes.
- **AC-10.3 (MUST)** A completed turn is fully reconstructable from its journal alone — asserted by materializing and comparing to the live state.
- **AC-10.4 (MUST)** A provider error transitions to a terminal failed state with the error journaled; the session remains resumable.
- **AC-10.5 (MUST)** `packages/kernel` imports no provider, no sandbox and no `node:fs` — asserted by `dependency-cruiser`.

**LRN-11 — CLI**
- **AC-11.1 (MUST)** `om run` starts an **interactive REPL**: it accepts a prompt, streams the answer, and accepts another **without restarting the process**. A scripted test completes three turns in one process.
- **AC-11.2 (MUST)** The REPL handles Ctrl-D (exit cleanly, session marked idle) and Ctrl-C (interrupt the current turn, keep the session).
- **AC-11.3 (MUST)** `om run -p "…"` runs one shot and exits.
- **AC-11.4 (MUST)** Assistant text renders **as it streams**, not after completion — asserted by observing partial output before the stream ends.
- **AC-11.5 (MUST)** `om sessions` lists this project's sessions with id, status and last activity, newest first.
- **AC-11.6 (MUST)** `om show <id>` renders a session from its journal with no provider call.
- **AC-11.7 (MUST)** Exit codes **0** (success), **1** (error) and **3** (limit exceeded) are each asserted by a test. **2 and 4 are deferred to LRN-22**, where policy can produce them.
- **AC-11.8 (MUST)** `--json` emits newline-delimited JSON events that parse against the protocol schemas.
- **Milestone gate for M1:** `om run` against the real endpoint, three turns, transcript pasted into the merge commit.

---

## M2 — "It reads your code" · *the agent answers questions about your repo*

**You will have:** `om run -p "where is auth handled?"` — it searches, reads files, and answers. It
still cannot change anything.

The boundary port arrives here and is **never bypassed again**. A small TypeScript implementation sits
behind it for now; M4 replaces it with the sandboxed Rust one without touching a single tool.

| # | Task | Type | Size | Depends | Req | Done when | Status | Comments |
|---|---|---|---|---|---|---|---|---|
| **LRN-12** | `packages/stub-client`: the port — typed `health`, `read`, `write`, `stat`, `glob`, `grep`, `exec`, `shell`, `batch`, each taking `{maxBytes, maxMs, cwd, capability}` and returning a terminal `{status, bytes, truncated, elapsedMs}` frame. **Every method in blueprint §8.2, none extra** | Core | M | 05 | LR-FR-007 | The interface is written before any implementation exists; `write`, `shell` and `batch` may throw `NotImplemented` until M3 but are in the type | todo | — |
| **LRN-13** | The `local-ts` driver behind the port (in `stub-client`): real fs and spawn, **path containment** (canonicalize → verify inside root → open) and byte/time budgets. **Plus the shared driver contract suite** that any driver must pass — the Rust stub reuses it verbatim in LRN-30 | Core | M | 12 | LR-FR-007, LR-FR-008, LR-FR-013 | Containment tests including `../` and a symlink out. The contract suite is a separate exported test module, not inline tests. Adversarial testing is LRN-32 | todo | — |
| **LRN-14** | **Boundary lint.** `dependency-cruiser` for dependency direction, plus a rule banning `child_process` and direct fs access anywhere except `stub-client`, `storage` and (later) `native/` | Harden | M | 13 | LR-FR-006 | Two planted violations each fail the lint. **Do this now, while there are three files to fix, not thirty** | todo | — |
| **LRN-15** | CI: one macOS workflow — install, biome, `tsc --noEmit`, dependency-cruiser, tests | Harden | S | 14 | §11 | Green on push. One OS in the matrix | todo | — |
| **LRN-16** | `packages/tools`: the `Tool` interface (`descriptor` / `plan` → `CapabilityRequest` / `execute`), the registry, and a test pinning the roster at 7 | Core | M | 12 | LR-FR-015, LR-FR-020 | A tool without `plan()` does not compile; an eighth tool fails a test | todo | — |
| **LRN-17** | Read tools: `read` (with line ranges), `grep`, `glob` — each with an accurate `plan()`, each going through the port | Core | M | 16 | LR-FR-020 | The model can explore a repo and provably cannot change it | todo | — |
| **LRN-18** | Multi-tool turn: tool calls execute, results return to the model, the loop continues until it answers. Parallel calls run concurrently | Core | M | 10, 17 | LR-FR-019 | **`om run -p "where is auth handled?"` gives a correct answer on a real repo of yours** | todo | — |
| **LRN-19** | **Central bounding.** The runtime — not any tool — truncates results, notes the truncation and spills the rest to a file. Turn count, wall-clock and byte caps live in this one module | Core | M | 18 | LR-FR-023, LR-NFR-003 | A 50 MB command output cannot blow the context. **Zero truncation logic inside any tool** | todo | — |
| **LRN-20** | Repository discovery: git root, ignore rules, and `AGENTS.md` / `CLAUDE.md` loaded into the prompt, journaled by content hash | Core | S | 09, 17 | LR-FR-024 | Works from a subdirectory of a repo. Worktrees and monorepo package detection are deferred until you need them | todo | — |

### Acceptance criteria — M2

**LRN-12 — The stub port**
- **AC-12.1 (MUST)** The port declares exactly the blueprint §8.2 methods: `health`, `read`, `write`, `stat`, `glob`, `grep`, `exec`, `shell`, `batch` — no more, no fewer.
- **AC-12.2 (MUST)** Every method accepts `{maxBytes, maxMs, cwd, capability}` and resolves to a terminal frame `{status, bytes, truncated, elapsedMs}`.
- **AC-12.3 (MUST)** Streaming methods (`read`, `exec`, `shell`, `grep`) return async iterables, not buffered results.
- **AC-12.4 (MUST)** Methods not yet implemented throw a typed `NotImplemented` naming the milestone that delivers them — they are **present in the type** from now on.
- **AC-12.5 (MUST)** The interface is committed **before** any implementation exists.

**LRN-13 — `local-ts` driver + shared contract suite**
- **AC-13.1 (MUST)** The driver resolves every path as: canonicalize → assert inside workspace root → open → **re-verify after open** → act.
- **AC-13.2 (MUST)** Containment tests cover at minimum: `../` traversal, an absolute path outside the root, a symlink inside the root pointing outside, and a path whose parent is a symlink.
- **AC-13.3 (MUST)** `maxBytes` truncates the stream and sets `truncated: true`; `maxMs` aborts and reports elapsed time. Both asserted for `read` and `exec`.
- **AC-13.4 (MUST)** `exec` spawns by program and argv with **no shell interpretation** — a test passes `; rm -rf x` as an argv element and asserts it is treated as a literal argument.
- **AC-13.5 (MUST)** `glob`/`grep` honour `.gitignore` and the byte budget; results match `rg` on a fixture repo for a defined pattern set.
- **AC-13.6 (MUST)** **The driver contract suite is an exported, reusable test module** parameterized over a driver factory — not tests inlined against this implementation. LRN-30 must be able to run it verbatim against the Rust stub.
- **AC-13.7 (MUST)** The contract suite covers every implemented method's success path, budget path and containment path.
- **Rejects:** any path resolution that checks before opening and then acts on the name; a contract suite that cannot be pointed at a second driver.

**LRN-14 — Boundary lint**
- **AC-14.1 (MUST)** Importing `node:child_process`, `node:fs` or `node:fs/promises` anywhere outside `packages/stub-client`, `packages/storage` and `native/` fails the lint.
- **AC-14.2 (MUST)** A planted violation of each of those two categories is committed as a **fixture that the lint test asserts fails** — then removed from the build.
- **AC-14.3 (MUST)** `packages/storage` may write only under `~/.om-code/`; a rule or test asserts it never writes a workspace path.
- **AC-14.4 (MUST)** The dependency direction from blueprint §6 is encoded and violations fail.
- **AC-14.5 (MUST)** The lint runs in CI and locally via one command.

**LRN-15 — CI**
- **AC-15.1 (MUST)** One workflow, `macos-latest` arm64 only — no other OS in the matrix.
- **AC-15.2 (MUST)** Steps: install (frozen lockfile), biome, `tsc --noEmit`, dependency-cruiser, unit + property tests.
- **AC-15.3 (MUST)** The workflow fails if the suite exceeds 3 minutes.
- **AC-15.4 (MUST)** Coverage is **printed, not gated**.

**LRN-16 — Tool interface and registry**
- **AC-16.1 (MUST)** `Tool` requires `descriptor()`, `plan() → CapabilityRequest` and `execute()`. A tool lacking `plan()` **does not compile**.
- **AC-16.2 (MUST)** `execute` receives the stub port and has no other I/O capability in scope.
- **AC-16.3 (MUST)** The registry rejects a duplicate tool name and a name not in the roster of seven.
- **AC-16.4 (MUST)** A test asserts the registered roster size is exactly 7; registering an eighth fails.
- **AC-16.5 (MUST)** Each tool's JSON schema is generated from one source shared with its runtime validation — no hand-written second copy.
- **AC-16.6 (MUST)** `plan()` is called and its result journaled **before** `execute()` in all cases, including when policy will allow it. Asserted by ordering in the journal.

**LRN-17 — Read tools**
- **AC-17.1 (MUST)** `read` supports whole-file and line-range reads and reports the file's total line count.
- **AC-17.2 (MUST)** `read`, `grep`, `glob` each declare `filesystem.read` only — a test asserts none of the three ever produces a capability containing `write` or `process`.
- **AC-17.3 (MUST)** All three route through the port; a test with a failing driver asserts they surface the driver's typed error rather than falling back to direct fs.
- **AC-17.4 (MUST)** `read` on a binary file returns a typed refusal, not mojibake.
- **AC-17.5 (MUST)** Output is line-numbered so subsequent edits can reference locations unambiguously.

**LRN-18 — Multi-tool turn**
- **AC-18.1 (MUST)** A model turn requesting *n* tool calls executes all *n* and returns all results before the next inference.
- **AC-18.2 (MUST)** Independent calls run concurrently; a test asserts wall-clock for 3 × 100 ms calls is well under 300 ms.
- **AC-18.3 (MUST)** Each call is journaled as `tool_call` then `tool_result`, correlated by id.
- **AC-18.4 (MUST)** A tool that throws yields a `tool_result` with failed status **fed back to the model** — the turn continues rather than aborting.
- **AC-18.5 (MUST)** The loop terminates when the model yields text with no tool calls, or when a bound trips.
- **AC-18.6 (MUST)** **End-to-end:** `om run -p "where is X handled?"` on a real repository returns a correct answer having actually searched and read files, verified by the journal.
- **Milestone gate for M2:** that end-to-end run, transcript in the merge commit.

**LRN-19 — Central bounding**
- **AC-19.1 (MUST)** Truncation happens in **one runtime module**. A grep lint asserts no truncation logic exists in `packages/tools`.
- **AC-19.2 (MUST)** A truncated result carries a structured notice stating the byte count and the spill location.
- **AC-19.3 (MUST)** The overflow is written to `~/.om-code/blobs/sha256/<ab>/<hash>` and is retrievable.
- **AC-19.4 (MUST)** Fuzz: a tool returning ≥ 50 MB never causes a context entry above its byte budget. Zero violations.
- **AC-19.5 (MUST)** `--max-turns` and the wall-clock cap terminate a run with exit code 3 and a journaled reason.
- **AC-19.6 (MUST)** `--max-cost` is **rejected at startup** with an explanatory message when pricing is unconfigured or the endpoint reports no usage (blueprint §8.1); when both are present it is enforced within one in-flight call.
- **AC-19.7 (MUST)** `notrunc` opt-out exists and is honoured only for explicitly marked calls.

**LRN-20 — Repository discovery**
- **AC-20.1 (MUST)** Git root is found from any subdirectory; running outside a git repo is a clear refusal or an explicit single-directory mode, not a crash.
- **AC-20.2 (MUST)** `AGENTS.md` then `CLAUDE.md` are loaded into the prompt in that order and journaled by content hash.
- **AC-20.3 (MUST)** `.gitignore` rules reach the search tools.
- **AC-20.4 (MUST)** Worktrees and monorepo package detection are **explicitly out of scope** — a comment records the deferral.

---

## M3 — "It asks, then edits" · *a working coding agent*

**You will have:** the agent proposes an edit, you see a diff, you approve, it applies exactly. **This
is the product.** If you stop here you have something genuinely useful.

Ordering inside this milestone is a safety property (blueprint D-09): **policy lands before write
tools.** Do not reorder for convenience.

| # | Task | Type | Size | Depends | Req | Done when | Status | Comments |
|---|---|---|---|---|---|---|---|---|
| **LRN-21a** | `packages/policy`: the decision core — `CapabilityRequest` → `{outcome: allow \| ask \| deny, reason, ruleId}`, the rule representation, and precedence `deny > ask > allow` when several rules match. One tier, no modes yet | Core | M | 16 | LR-FR-016 | Tool names are not an input — asserted by the signature and a grep lint | todo | — |
| **LRN-21b** | Tier resolution: user > project > session, merged into one decision. **A lower tier cannot loosen a higher tier's `deny`** | Core | M | 21a | LR-FR-016 | A test asserts a session rule cannot unlock what the user tier denied | todo | — |
| **LRN-21c** | Modes: `read_only` (denies every `write_workspace`, `exec` and `destructive` capability) and `manual`. **Plus the full matrix test** over mode × capability class × tier — all three dimensions now exist | Core | S | 21b | LR-FR-016 | The matrix test enumerates every combination and each cell asserts an expected outcome | todo | — |
| **LRN-21d** | **Fail-closed and journaling.** A thrown error during evaluation becomes `deny`; an unrecognized or partly parsed capability becomes `ask`; every decision is journaled with `decided_by` before the effect runs | Core | M | 21c | LR-FR-016, LR-NFR-004 | Fail-closed is proven by a test that makes evaluation throw, not by a comment saying it does | todo | — |
| **LRN-22** | Approvals in the terminal: what it wants to do, which paths, a diff for edits, and the reason — `once` or `session`, every decision journaled with who decided. A TTY-less run exits 2 with a resumable payload instead of prompting | Core | M | 21d | LR-FR-017 | A piped run never prompts and never hangs | todo | — |
| **LRN-23** | `packages/patch`: the `str_replace` engine — exact match, uniqueness check, whitespace-tolerant fallback **only** when the match is unique, and on failure the nearest candidates with line numbers and **the file untouched** | Core | L | 13 | LR-FR-021 | Silent fuzzy application is impossible by construction. **TypeScript, and it stays TypeScript** — it is pure string logic with no OS access, so Rust buys nothing (blueprint §6 updated to match) | todo | — |
| **LRN-24** | 12–15 edit fixtures covering the ways this breaks: CRLF, BOM, tabs vs spaces, near-duplicate anchors, an anchor appearing twice, trailing whitespace | Core | S | 23 | LR-FR-021 | **0 wrong-location applications.** That number matters far more than the apply rate | todo | — |
| **LRN-25** | Checkpoints: copy each file's bytes before writing it, so a bad edit is one command to undo | Core | M | 23 | LR-FR-022 | `om undo` restores the last edit on a real repo | todo | — |
| **LRN-26** | `edit` and `write` tools with accurate `plan()`, gated by policy | Core | M | 21d, 23, 25 | LR-FR-020 | The model changes a file only after you approved that exact change | todo | — |
| **LRN-27** | Shell decomposition + the `bash` tool: split on `&&`, `\|\|`, `;`, `\|`, `$()`, backticks and leading assignments into per-subcommand capabilities. **Anything not fully parsed escalates to `ask`** | Core | L | 21d | LR-FR-018, LR-NFR-004 | A property test tries to smuggle an effect past the parser; every miss lands on `ask`, never `allow` | todo | — |
| **LRN-28** | `todo` tool, completing the roster of 7 | Core | S | 16 | LR-FR-020 | The model keeps a visible task list across a long turn | todo | — |
| **LRN-29** | Resume: `om resume <id>` continues a session, including one that stopped at exit 2 awaiting approval. An operation whose outcome is unknown after a crash is **surfaced, never re-run** | Core | M | 06, 18, 22 | LR-FR-003, D-10 | Kill it mid-tool-call, resume, and it tells you what it doesn't know; a needs-approval session resumes at the pending decision | todo | — |

### Acceptance criteria — M3

**LRN-21a — Decision core**
- **AC-21.1 (MUST)** Evaluation takes a `CapabilityRequest` and returns `allow | ask | deny` with a reason and the rule id. **Tool names are never an input** — asserted by the function signature and a grep lint.
- **AC-21.2a (MUST)** When several rules match one request, precedence is `deny > ask > allow` — asserted for each pair.
- **Completion:** the signature LRN-16's `plan()` already produces is consumed unchanged (X-4). If it needs reshaping, fix `CapabilityRequest` here, before six more tools depend on it.

**LRN-21b — Tier resolution**
- **AC-21.2b (MUST)** Tiers resolve user > project > session into a single decision, with the winning tier named in the reason.
- **AC-21.3 (MUST)** A lower tier cannot loosen a higher tier's `deny` — asserted directly.

**LRN-21c — Modes and the matrix**
- **AC-21.6 (MUST)** `read_only` mode denies every `write_workspace`, `exec` and `destructive` capability.
- **AC-21.2c (MUST)** A matrix test covers every mode × capability class × tier combination, each cell asserting an expected outcome. All three dimensions exist only now — this is the first point at which the matrix is passable.

**LRN-21d — Fail-closed and journaling**
- **AC-21.4 (MUST)** Any thrown error during evaluation results in `deny`, journaled with the error. **Fail closed** is a test, not a comment.
- **AC-21.5 (MUST)** An unrecognized or partially parsed capability yields `ask`, never `allow`.
- **AC-21.7 (MUST)** Every decision is journaled with `decided_by` before the effect occurs.
- **Rejects:** an evaluation path that can return `allow` for input it did not fully understand.

**LRN-22 — Approvals**
- **AC-22.1 (MUST)** The prompt shows the tool, the capability summary (exact paths to be read/written, exact command to be run) and the reason.
- **AC-22.2 (MUST)** For an edit, a unified diff of the **actual** proposed change is shown before the decision.
- **AC-22.3 (MUST)** Scopes `once` and `session` are offered; a `session` grant applies to a subsequent identical capability and a test asserts it does **not** apply to a different one.
- **AC-22.4 (MUST)** Every decision is journaled with `decided_by`, scope, reason and timestamp.
- **AC-22.5 (MUST)** With no TTY, the run **never prompts and never hangs**: it exits **2** with a resumable payload naming the session id and the pending capability.
- **AC-22.6 (MUST)** A denied capability yields exit **4** and a `tool_result` describing the denial fed back to the model.
- **AC-22.7 (MUST)** Exit codes 2 and 4 are asserted here, completing the LR-FR-005 contract begun in AC-11.7.
- **AC-22.8 (MUST)** An approval timeout denies and journals `decided_by: timeout`.

**LRN-23 — `str_replace` engine** *(`packages/patch`, TypeScript)*
- **AC-23.1 (MUST)** An exact single match applies.
- **AC-23.2 (MUST)** **Zero matches**: the file is unmodified and the result lists the nearest candidates with line numbers.
- **AC-23.3 (MUST)** **Multiple matches**: the file is unmodified and the result reports every match location. It never picks one.
- **AC-23.4 (MUST)** The whitespace-tolerant fallback runs **only** when it produces exactly one match; two tolerant matches is a failure, not a choice.
- **AC-23.5 (MUST)** On every failure path the file's bytes are unchanged — asserted by hashing before and after.
- **AC-23.6 (MUST)** Line endings, BOM and trailing-newline state are preserved exactly.
- **AC-23.7 (MUST)** `packages/patch` imports no OS module and no journal — it is a pure function.
- **Rejects:** applying to the first of several matches; any silent fuzzy application.

**LRN-24 — Edit fixtures**
- **AC-24.1 (MUST)** 12–15 fixtures covering at least: CRLF file, BOM file, tabs, mixed indentation, an anchor appearing twice, an anchor that is a substring of another, trailing whitespace, empty file, single-line file, no trailing newline.
- **AC-24.2 (MUST)** **Zero wrong-location applications** across the corpus. This is the number that matters.
- **AC-24.3 (MUST)** Apply rate is measured and recorded; a failure to apply with a correct candidate list counts as correct behaviour, not a miss.
- **AC-24.4 (MUST)** The harness reports per-fixture results so a regression names the case.

**LRN-25 — Checkpoints**
- **AC-25.1 (MUST)** Before any write, the file's prior bytes are stored content-addressed and a `checkpoint` entry is journaled **before** the write occurs.
- **AC-25.2 (MUST)** `om undo` restores the files of the most recent checkpoint and reports what it restored.
- **AC-25.3 (MUST)** A checkpoint that skipped a symlink or hardlink is marked `restorable: false`, and restore **refuses it with an explanation** rather than partially rolling back.
- **AC-25.4 (MUST)** Restoring a file changed since the checkpoint warns and requires confirmation.
- **AC-25.5 (MUST)** Round-trip verified on a fixture repo: content, line endings and mode all preserved.

**LRN-26 — `edit` and `write` tools**
- **AC-26.1 (MUST)** Both declare an accurate `filesystem.write` capability naming the exact paths; a test compares the declared paths to the paths actually written.
- **AC-26.2 (MUST)** No write occurs without a policy decision — asserted by journal ordering (`plan` → decision → effect).
- **AC-26.3 (MUST) — stale edit:** if the file's content hash changed since the model read it, the edit **fails with a stale-read error** and is not applied. The model is told to re-read.
- **AC-26.4 (MUST) — approval invalidation:** if the tool input changes between approval and execution, the approval is **void** and the capability is re-evaluated. A test mutates the input post-approval and asserts re-prompting.
- **AC-26.5 (MUST)** A checkpoint exists for every file written, verified after the fact.
- **AC-26.6 (MUST)** End-to-end: the model proposes an edit, the diff is shown, approval applies it exactly, and the journal contains plan, decision, checkpoint and result in that order.
- **Rejects:** writing a file the capability did not name; applying an edit after its approval's input changed.

**LRN-27 — Shell decomposition and `bash`**
- **AC-27.1 (MUST)** A command string decomposes on `&&`, `||`, `;`, `|`, `$()`, backticks and leading `VAR=value` into per-subcommand capabilities.
- **AC-27.2 (MUST)** **Any construct not fully parsed escalates to `ask`.** A property test generates command strings and asserts the parser **never** returns `allow` for input it did not fully model. A miss must land on `ask`.
- **AC-27.3 (MUST)** Specific adversarial cases are covered: nested `$( )`, a backtick inside a string, `|` inside a quoted argument, a here-doc, a trailing `&`, and a subshell `( )`.
- **AC-27.4 (MUST) — validate twice:** the `shell` request carries the host's decomposed capability list; the driver **independently re-decomposes** and refuses if its parse yields an effect not present in that list. Asserted by a test that hand-crafts a mismatched request.
- **AC-27.5 (MUST)** The `bash` tool declares `process` plus the filesystem effects its decomposition found.
- **AC-27.6 (MUST)** Output is bounded by LRN-19's module, not by the tool.
- **AC-27.7 (MUST)** A destructive-class command (`rm -rf`, force push) always asks, regardless of any allow rule.
- **Rejects:** an `allow` on an expansion the parser could not resolve; the driver trusting the host's decomposition without re-checking.

**LRN-28 — `todo` tool**
- **AC-28.1 (MUST)** Todo state lives **only** in journal entries — asserted by materializing from the journal and comparing.
- **AC-28.2 (MUST)** The list survives a resume.
- **AC-28.3 (MUST)** The roster is now exactly 7; the size test passes unchanged.

**LRN-29 — Resume with reconciliation**
- **AC-29.1 (MUST)** `om resume <id>` materializes the session and continues the conversation.
- **AC-29.2 (MUST) — crash between effect and result:** a `tool_call` with no corresponding `tool_result` is marked `unknown` on resume, **surfaced to you in the transcript, and never re-executed**. A test kills the process between a write and its result record and asserts all three.
- **AC-29.3 (MUST)** A session that exited 2 awaiting approval resumes **at the pending decision**, with the original capability intact.
- **AC-29.4 (MUST)** Resume completes within 2 s for a large session; the number is measured and recorded.
- **AC-29.5 (MUST)** Resuming a session held by a live writer fails fast on the LRN-06 lock.
- **Rejects:** re-running any command whose outcome is unknown.
- **Milestone gate for M3:** the approved-edit demonstration below, transcript in the merge commit — the model proposes an edit on a real repository, in `manual` mode, you see the diff and capability summary, you approve, it applies exactly, and the journal contains the decision. A command with an unparsed construct escalates to `ask`. Non-interactive mode exits 2 instead of prompting.

---

## M4 — "It's contained" · *the boundary becomes real*

**You will have:** the same agent, with everything it does running as a separate sandboxed process
that cannot leave your workspace or reach the network.

**All Harden, none optional.** Until this milestone lands, `om` is a program that edits files on your
machine with your approval and nothing stopping it if you approve carelessly. That is an acceptable
place to *be* for a while; it is not an acceptable place to *stay*.

| # | Task | Type | Size | Depends | Req | Done when | Status | Comments |
|---|---|---|---|---|---|---|---|---|
| **LRN-30** | Cargo workspace + `native/om-stub`: JSON-RPC over stdio, `health` (version, profile in force, enforcement status), and `read`/`write`/`stat`/`glob`/`grep`/`exec` with the same budgets the TS one enforced. `exec` kills the process tree on budget exhaustion | Harden | L | 13 | LR-FR-007, LR-FR-009 | A SIGTERM-ignoring process is dead within 1 s. `om-stub` passes the **same contract tests** the TS implementation passes | todo | — |
| **LRN-31** | **Swap.** `stub-client` drives the Rust stub; the TypeScript implementation stays as the in-process test fake | Harden | M | 30 | LR-FR-007 | Every M2/M3 test still passes with no change to any tool. **If a tool needs changing, the port leaked — fix that first** | todo | — |
| **LRN-32** | Path containment `proptest` in Rust: symlink escape, case-insensitive collision, unicode normalization, TOCTOU (swap the path between canonicalize and open) | Harden | L | 30 | LR-FR-008, LR-NFR-001 | No generated input reads or writes outside the root. **Write this adversarially — it is the most valuable test in the project** | todo | — |
| **LRN-33** | `packages/sandbox`: placement port + the Seatbelt driver over `@anthropic-ai/sandbox-runtime`. Workspace read/write, **no network at all** (D-01), fail closed if the profile cannot be enforced | Harden | L | 31 | LR-FR-010 | Startup refuses with remediation text rather than degrading. Profile scope documented in `docs/architecture/sandbox.md` | todo | — |
| **LRN-34** | Config-path deny list (`.git/hooks`, `.git/config`, `.mcp.json`, agent config dirs, shell startup files) plus escape tests: outside-root write, denied config path, symlink escape, network connect, budget overrun | Harden | M | 33 | LR-FR-011, LR-FR-012 | All five blocked on macOS arm64, and the report says which profile it ran under | todo | — |
| **LRN-35** | `om doctor`: toolchain, stub version, sandbox enforceability, config validity, endpoint reachability — each failure prints how to fix it. Same probes run at startup | Harden | M | 33 | LR-FR-031 | Every check has a failing-case test | todo | — |

### Acceptance criteria — M4

**LRN-30 — Rust stub**
- **AC-30.1 (MUST)** Cargo workspace builds; `cargo fmt --check` and `cargo clippy -- -D warnings` are clean.
- **AC-30.2 (MUST)** JSON-RPC 2.0 over stdio; `health` returns version, sandbox profile in force and enforcement status.
- **AC-30.3 (MUST)** A protocol version mismatch is **refused at handshake**, not warned about.
- **AC-30.4 (MUST)** Rust DTOs are generated from or schema-checked against `packages/protocol`; a round-trip test fails when a field is renamed on either side.
- **AC-30.5 (MUST)** **It passes the LRN-13 contract suite verbatim**, with no suite modifications. Any change required to the suite is a defect in the port, not in the suite.
- **AC-30.6 (MUST)** `exec` kills the whole process tree on budget exhaustion; a process trapping SIGTERM is dead within 1 s, verified by a test that spawns exactly such a process.
- **AC-30.7 (MUST)** Budgets are enforced **inside the stub**, not only by the caller — a hand-crafted oversized response is still truncated.

**LRN-31 — The swap**
- **AC-31.1 (MUST)** `stub-client` selects the driver by configuration; `stub-rpc` becomes the default.
- **AC-31.2 (MUST)** **Every M2 and M3 test passes with zero changes to any file under `packages/tools`.** The diff for this task is the proof; if a tool changed, the port leaked and that is the defect to fix first.
- **AC-31.3 (MUST)** `local-ts` is retained as the in-process test fake and still passes the contract suite.
- **AC-31.4 (MUST)** Stub crash mid-stream surfaces a typed error, one reconnect is attempted, and the turn then fails cleanly with the session resumable.

**LRN-32 — Path containment properties**
- **AC-32.1 (MUST)** `proptest` generates paths including `..` segments, absolute paths, symlink chains, unicode-normalization variants (NFC/NFD) and case variants.
- **AC-32.2 (MUST)** **No generated input reads or writes outside the workspace root.** Zero counterexamples.
- **AC-32.3 (MUST)** A TOCTOU test replaces the path with a symlink between canonicalize and open, and asserts the operation is refused.
- **AC-32.4 (MUST)** macOS case-insensitivity is covered: `/Foo` and `/foo` resolving to one file cannot be used to escape.
- **AC-32.5 (MUST)** Any counterexample found is committed as a **named regression test** before being fixed.

**LRN-33 — Seatbelt placement**
- **AC-33.1 (MUST)** The stub runs under a generated Seatbelt profile via `@anthropic-ai/sandbox-runtime`.
- **AC-33.2 (MUST)** The profile allows workspace read, workspace write minus denied paths, and **no network at all**. A test inside the sandbox attempting an outbound connection fails.
- **AC-33.3 (MUST)** If the profile cannot be enforced, **startup fails** with remediation text. It never degrades to unsandboxed — a test forces the failure and asserts the refusal.
- **AC-33.4 (MUST)** `health` reports the profile actually in force, and the host verifies it matches what it requested.
- **AC-33.5 (MUST)** The exact profile scope and the reasoning for each grant is documented in `docs/architecture/sandbox.md`.
- **Rejects:** any code path that continues unsandboxed after an enforcement failure.

**LRN-34 — Deny list and escape tests**
- **AC-34.1 (MUST)** Writes to `.git/hooks`, `.git/config`, `.mcp.json`, agent config directories and shell startup files are blocked.
- **AC-34.2 (MUST)** A user rule attempting to allow a denied config path is **itself rejected**, with a test.
- **AC-34.3 (MUST)** Escape classes all blocked: outside-root write, denied config path, symlink escape, network connect, budget overrun.
- **AC-34.4 (MUST)** The report is machine-readable and **names the sandbox profile it ran under** — a pass under an unknown profile proves nothing.
- **AC-34.5 (MUST)** The suite runs in CI on every change to `native/`, `packages/policy`, `packages/sandbox` or `packages/stub-client`.
- **AC-34.6 (MUST)** Each class has a **negative control**: with the sandbox disabled the class succeeds, proving the test can detect a failure.
- **Rejects:** a green suite that would stay green with the sandbox turned off.

**LRN-35 — `om doctor`**
- **AC-35.1 (MUST)** Checks toolchain versions, stub binary presence and version, sandbox enforceability, config validity and endpoint reachability.
- **AC-35.2 (MUST)** Every failure prints a specific remediation, not just a status.
- **AC-35.3 (MUST)** Each check has a test that forces its failure and asserts the message.
- **AC-35.4 (MUST)** The same probes run at startup; an unenforceable sandbox refuses to start.
- **AC-35.5 (MUST)** `om doctor --bench` measures and prints startup time and per-call driver overhead. **Record the real numbers**; if they exceed LR-NFR-007's targets, update the target with the measurement rather than leaving an aspiration.
- **Milestone gate for M4:** escape report green with profile named, plus the LRN-31 zero-tool-change diff.

---

## M5 — "It's usable" · *you reach for it without thinking*

**You will have:** something you use daily.

| # | Task | Type | Size | Depends | Req | Done when | Status | Comments |
|---|---|---|---|---|---|---|---|---|
| **LRN-36** | Context accounting per component, shown by `om context` | Core | M | 19 | LR-FR-025 | Within 2% of the endpoint's reported prompt tokens | todo | — |
| **LRN-37** | Compaction: drop the oldest tool results first, then summarize into a `compaction` entry **appended** to the journal. A guard stops after K attempts and tells you rather than looping | Core | L | 36 | LR-FR-026 | **The journal is never rewritten.** A long session crosses the threshold and keeps working | todo | — |
| **LRN-38** | Cancellation: Ctrl-C kills in-flight stub work within 1 s and leaves the session resumable | Core | M | 29 | LR-FR-028 | The journal shows a cancelled call, not a dangling one | todo | — |
| **LRN-39** | Argument repair: JSON repair and dialect tolerance for the malformed tool calls your endpoint actually produces; genuinely ambiguous input becomes a retryable error, not a guess | Harden | M | 07c | LR-FR-027 | Built from real failures you collected, not imagined ones | todo | — |
| **LRN-40** | Crash recovery: kill at ~20 meaningful points (mid-stream, mid-write, between effect and result), assert no committed record is lost | Harden | M | 29 | LR-NFR-002 | 20/20 recover. Twenty real points beat two hundred generated ones | todo | — |
| **LRN-41** | Secret hygiene: explicit env allowlist for the stub, redaction before anything is journaled, and a scanner over test artifacts. Plus one structured local log line per turn and tool call, content off by default | Harden | M | 31 | LR-FR-030, LR-NFR-005 | The scanner finds no key material; the stub's environment is asserted, not assumed | todo | — |
| **LRN-42** | `om replay <id>`: reconstruct and print the tool sequence from a journal with **no provider calls at all** | Core | S | 29 | LR-FR-029 | Replay of a recorded session reproduces its tool sequence exactly; a network-blocking test proves no provider call is made | todo | — |
| **LRN-43** | **Use it for two weeks on real work.** Every annoyance becomes a one-line issue; fix the top five | Core | L | 38, 42 | §11 | You reached for `om` on a real change and finished with it | todo | — |

### Acceptance criteria — M5

**LRN-36 — Context accounting**
- **AC-36.1 (MUST)** Tokens are attributed per component: system prompt, instructions, tool schemas, conversation, tool results by age, reserved output.
- **AC-36.2 (MUST)** The total is within 2% of the endpoint's reported prompt tokens on fixtures where usage is reported.
- **AC-36.3 (MUST)** Where usage is not reported, the display says **estimated** and names the tokenizer assumption.
- **AC-36.4 (MUST)** `om context` shows the breakdown and the percentage of the window in use.

**LRN-37 — Compaction**
- **AC-37.1 (MUST)** Oldest tool results are evicted to placeholders first, before any summarization.
- **AC-37.2 (MUST)** Summarization appends a `compaction` entry. **Compaction never rewrites the journal** — asserted by comparing the file's prior bytes as a prefix of the new file. LRN-06 incomplete-tail repair is the separately tested exception.
- **AC-37.3 (MUST)** The structured summary carries the blueprint §7 fields.
- **AC-37.4 (MUST)** The request built after compaction is a provable fold of the journal — a test reconstructs it from the journal alone and compares.
- **AC-37.5 (MUST)** The thrash guard stops after K attempts and surfaces an error naming the cause, rather than looping.
- **AC-37.6 (MUST)** A long scripted session crosses the threshold and completes successfully.
- **Rejects:** any compaction mutation of previously written journal bytes.

**LRN-38 — Cancellation**
- **AC-38.1 (MUST)** Ctrl-C during inference aborts the stream; the partial assistant message is journaled.
- **AC-38.2 (MUST)** Ctrl-C during a tool call kills in-flight driver work **within 1 s**, measured.
- **AC-38.3 (MUST)** The journal records a **cancelled** tool call — never a dangling `tool_call` with no result.
- **AC-38.4 (MUST)** The session remains resumable and `om resume` continues cleanly.
- **AC-38.5 (MUST)** A second Ctrl-C exits the process without corrupting the journal.

**LRN-39 — Argument repair**
- **AC-39.1 (MUST)** Repairs are driven by **failures you actually collected** from your endpoint, each captured as a fixture — not invented cases.
- **AC-39.2 (MUST)** Trailing commas, unquoted keys, single quotes and truncated JSON are repaired when unambiguous.
- **AC-39.3 (MUST)** Genuinely ambiguous input becomes a **structured retryable error** fed back to the model, never a guess.
- **AC-39.4 (MUST)** Repetition-loop detection halts a model repeating an identical failing call after N attempts.
- **AC-39.5 (MUST)** Every repair is journaled so you can see what was changed and why.
- **Rejects:** silently guessing an argument value.

**LRN-40 — Crash recovery**
- **AC-40.1 (MUST)** ~20 kill points at **meaningful** boundaries: mid-stream, between `plan` and decision, between decision and effect, between effect and result, mid-write, mid-compaction, mid-checkpoint.
- **AC-40.2 (MUST)** 20/20 restarts lose no committed record and materialize successfully.
- **AC-40.3 (MUST)** Any point requiring manual repair is filed as a defect, not documented as a caveat.
- **AC-40.4 (MUST)** The kill point that lands between a tool's effect and its result produces `unknown` status, closing the loop with AC-29.2.

**LRN-41 — Secret hygiene and logs**
- **AC-41.1 (MUST)** The stub's environment is an **explicit allowlist**; a test asserts the credential variable is absent from the child process environment.
- **AC-41.2 (MUST)** Redaction runs before anything enters the journal, a log or a tool result.
- **AC-41.3 (MUST)** A scanner over all test artifacts fails if key material appears; it is proved effective by a fixture containing a planted fake key.
- **AC-41.4 (MUST)** One structured log line per turn and per tool call, with prompt/response content **off by default**.
- **AC-41.5 (MUST)** Enabling content logging requires an explicit flag and prints a warning.

**LRN-42 — `om replay`**
- **AC-42.1 (MUST)** `om replay <id>` reconstructs and prints the tool sequence from the journal.
- **AC-42.2 (MUST)** **No provider call is made** — asserted by running it under the network guard from AC-8.5.
- **AC-42.3 (MUST)** Replay of a recorded session reproduces its tool sequence exactly, compared programmatically.
- **AC-42.4 (MUST)** Replay and `rerun` are not conflated: there is no `rerun` in this release, and `replay` states in its help that it never calls a model.

**LRN-43 — Two weeks of real use**
- **AC-43.1 (MUST)** At least 10 real sessions on your own repositories, in `manual` mode.
- **AC-43.2 (MUST)** Every annoyance is captured as a one-line issue **at the time**, not remembered later.
- **AC-43.3 (MUST)** The top five by frequency are fixed, each with its own task and tests.
- **AC-43.4 (MUST)** At least one real multi-file change is completed end to end **without dropping to manual editing**.
- **AC-43.5 (MUST)** A short honest retrospective in `docs/retro-m5.md`: what the architecture got right, what it got wrong, and what you would remove.
- **Milestone gate for M5:** AC-43.4 achieved and the retrospective written.

---

## Later, only if you want to

Not planned, not committed. Each has a re-entry condition in blueprint §14 — read it first.

| Task | Take it if |
|---|---|
| Ink TUI | The plain CLI is the thing annoying you |
| MCP client | You want the agent to have real tools |
| Directors (plan / goal / force-tool) | The loop is solid and loop control is what you want to learn next |
| Fork / rewind | You want to branch a session mid-way |
| V4A `apply_patch` | You move to a model trained on it |
| OTel traces | You're debugging across many sessions |

---

## The shape of it

```
M1  01 spike ─▶ 03 workspace ─▶ 05 protocol ─▶ 06 journal ─▶ 07a─d provider ─▶ 09 prompt ─▶ 10 loop ─▶ 11 CLI
                                                             07a port+text ─▶ 07b usage/retry ─┐
                                                                           ─▶ 07c tool calls ──┴▶ 07d cancel
                                                                                                    │
M2                                    12 port ─▶ 13 TS stub ─▶ 16 tools ─▶ 17 read tools ─▶ 18 multi-tool turn
                                                                                                    │
M3                        21a─d policy ─▶ 22 approvals ─▶ 26 edit tools ◀─ 23 str_replace ─▶ 25 checkpoints
                          21a core ─▶ 21b tiers ─▶ 21c modes ─▶ 21d fail-closed
                                                                                                    │
M4                              30 Rust stub ─▶ 31 swap ─▶ 33 Seatbelt ─▶ 34 escape tests
                                                                                                    │
M5                                                                  37 compaction ─▶ 42 replay ─▶ 43 use it
```

**Three tasks worth slowing down for:**

- **LRN-01** (endpoint spike) — an evening that can save you a month of debugging your own correct code.
- **LRN-27** (shell decomposition) — the place where a subtle bug is a security bug.
- **LRN-32** (path containment properties) — the same, and the best test you will write here.

---

## Cross-task dependency map

The linear order hides these. Each is a place where finishing task A without knowing about task B
creates rework.

| # | Relationship | Why it matters | Where enforced |
|---|---|---|---|
| **X-1** | **LRN-13 → LRN-30** | The driver contract suite must be *exported and parameterized* at LRN-13, or the Rust stub in M4 has nothing to be verified against and M4's exit gate is unmeasurable | AC-13.6, AC-30.5 |
| **X-2** | **LRN-12 → LRN-23/25/26** | `write` must be in the port from the start or M3 tools have no legal way to modify a file | AC-12.1 |
| **X-3** | **LRN-11 → LRN-22** | Exit codes 2 and 4 are defined in M1 but cannot be produced until policy exists. Split the contract across both tasks or LRN-11 is unpassable | AC-11.7, AC-22.7 |
| **X-4** | **LRN-16 → LRN-21a** | `plan()` must return the capability shape policy will consume. Designing `CapabilityRequest` when writing the *first tool* rather than when writing policy avoids reworking all seven | AC-16.1, AC-21.1 |
| **X-5** | **LRN-19 → LRN-27** | Bounding must exist before `bash`, which produces the largest outputs in the system. Reversing these means discovering the invariant is missing under load | AC-19.1, AC-27.6 |
| **X-6** | **LRN-21a–d/22 → LRN-26/27** | The D-09 safety ordering: policy and approvals before any write or exec tool | Blueprint D-09 |
| **X-7** | **LRN-23 → LRN-25 → LRN-26** | Checkpoints must exist before the write tools ship, or your first bad edit has no undo | AC-26.5 |
| **X-8** | **LRN-06 → LRN-29 → LRN-40** | Journal commit points determine what resume can recover, which determines which kill points can pass. Chosen at LRN-06, paid for at LRN-40 | AC-6.3, AC-40.1 |
| **X-9** | **LRN-08 → LRN-42, and all of M5** | The network guard written for the fake provider is what proves `replay` makes no provider call and that the suite costs nothing | AC-8.5, AC-42.2 |
| **X-10** | **LRN-01 → LRN-07c → LRN-39** | The endpoint's real dialect discovered in the spike shapes tool-call accumulation, and its real failures become the repair fixtures. Skipping the spike means guessing twice | AC-1.2, AC-7.3, AC-39.1 |
| **X-11** | **LRN-14 → everything after** | The boundary lint must land while three files violate it, not thirty. It is cheap in M2 and expensive in M4 | AC-14.2 |
| **X-12** | **LRN-09 → LRN-16 → LRN-36** | Tool schemas are assembled into the prompt and counted in context accounting. One source for the schema, used by all three | AC-9.2, AC-16.5, AC-36.1 |
| **X-13** | **LRN-33 → LRN-34** | An escape test that passes without naming the profile it ran under proves nothing; the negative control is what makes the suite meaningful | AC-34.4, AC-34.6 |

---

## What acceptance criteria deliberately do not cover

Not every property can be tested, and pretending otherwise is worse than admitting it.

- **"The sandbox is safe."** AC-34 proves five named classes were blocked under one named profile on
  macOS arm64. It is not a proof of containment, and the report must never be summarized as one.
- **"The agent is good."** No criterion measures answer quality. AC-43.4 is the closest, and it is
  deliberately subjective: did you finish a real change without giving up.
- **"The endpoint is compatible."** AC-7 proves the adapter handles what LRN-01 observed. A different
  endpoint, or the same one after an update, is untested until you run it.
- **Performance under sustained load.** LR-NFR-007 numbers are measurements taken once, recorded, and
  re-measured when they feel wrong.

---

## What this backlog deliberately leaves out

No Windows or Linux · no containers or VMs · no egress proxy or secret broker · no TUI · no
app-server, ACP, MCP or `dyn` · no plugins or hooks · no Directors or subagents · no fork or rewind ·
no SQLite projections · no Python, Harbor or experiments · no signing, notarization or install
channels · no worktree or monorepo discovery until something needs it.

If you want one of them, read its re-entry condition in blueprint §14 first. That is what it is for.
