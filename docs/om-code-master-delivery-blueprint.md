# om-code — Master Delivery Blueprint (Learning Release)

**Document type:** the single execution plan for this project
**Date:** 2026-09-05 · **Version:** 2.0 · **Status:** current
**Scope authority:** [ADR-023](docs/adr/ADR-023-macos-openai-compatible-learning-scope.md)
**Companions:** [architecture](docs/coding-agent-harness-final-architecture.md) (how it is built) · [backlog](docs/om-code-agent-execution-backlog.md) (what to do next)
**Replaces:** the v1.0 production/research blueprint (102-task backlog and experiments), archived at `docs/architecture/archive/2026-09-05-production-plan/` under ADR-023

---

## 0. How to use this document

You are one developer building a coding-agent harness on your MacBook to learn how these systems
actually work. This document says **what** to build and **what "done" means**. The
[backlog](docs/om-code-agent-execution-backlog.md) says **in what order**. The
[architecture](docs/coding-agent-harness-final-architecture.md) says **how**, and why each choice was made.

Three rules make the plan usable by one person:

1. **One milestone at a time, and each one ends with something that runs.** M1 → M5. No milestone is
   a pile of scaffolding you cannot exercise. If a milestone's exit gate can't be demonstrated from a
   terminal, it is written wrong. **M1–M3 give you a working coding agent; M4 makes it safe to trust;
   M5 makes it pleasant.** That is the honest order of value.
2. **Nothing here is blocked on anyone.** There is no reviewer, no procurement, no second machine, no
   inference budget approval. Every decision this plan needs has been made and is recorded in §2.
3. **Claims are scoped to what you ran.** A passing test proves that test passed on macOS arm64. It
   does not prove the sandbox is safe, the endpoint is compatible, or the platform is supported. Write
   down what you actually observed.

**Evidence tags:** `[D]` decided (settled, with rationale) · `[E]` external evidence (documented fact
from the architecture study) · `[J]` judgment (my call; change it if you learn better).

---

## 1. What this release is

**Product.** `om` — a terminal coding agent that reads and edits a real repository on your MacBook,
runs commands inside a macOS sandbox, asks before it does anything consequential, and records every
step in a journal you can replay.

**Purpose.** Learning. You are building this to understand agent-harness design from the inside:
the trust boundary, the session journal, the policy engine, the inference loop. Shipping it to other
people is not a goal, and no part of this plan is shaped by distribution.

**The one user.** You, on your own MacBook, in repositories you already trust. There is no fleet
administrator, no CI service account, no research operator, no editor client. Those roles existed in
the archived plan; they are gone, and with them most of the surface area.

**What success looks like.** At the end of M5 you have a tool you would actually reach for: it makes a
correct multi-file edit on one of your own repositories, you approved what it did, it survived being
killed mid-turn, and you can read back exactly what happened.

### 1.1 The five things this release must get right `[J]`

Everything else is negotiable. These are not:

1. **The boundary holds.** Every workspace read, write, search and command goes through the stub, in
   the sandbox. No exceptions, mechanically enforced.
2. **The journal is the truth.** Anything that affects behaviour across turns is in it. Kill the
   process at any point and the session comes back coherent.
3. **Policy runs before effects.** No model-initiated write or command executes without a capability
   decision, and unknown means ask.
4. **Edits are exact.** An edit either applies where you meant it or fails loudly with candidates.
   Silent fuzzy application is a defect.
5. **Bounds are central.** Output size, wall-clock and turn count are enforced in one place, not
   per tool.

---

## 2. Decisions — everything that was open is now closed

The archived plan carried twelve gaps (GAP-01…12) and eight blockers (B1…B8). None of them may block
work. Here is every one, resolved. Where a decision is mine rather than an ADR's, it is marked `[J]`
and carries a reversal trigger.

### 2.1 Resolved from the gap register

| Was | Question | **Decision** | Rationale | Reverse when |
|---|---|---|---|---|
| GAP-01 | Which edit format? No public head-to-head data | **`str_replace` only.** V4A `apply_patch` lands only if you actually adopt an OpenAI model trained on it; whole-file and hashline are out `[J]` | One engine, one failure mode to understand. The 300-edit corpus that would have settled this is a research artifact you don't need | You switch to a model whose tool-calling clearly favours V4A |
| GAP-02 | Does roster size affect wall-clock? | **Fix the roster at 7 tools.** No experiment `[J]` | The measurement direction is clear enough `[E]` and a small roster is cheap. Running a 3×20×5 study is not a solo activity | Never for this release |
| GAP-03 | Windows sandbox limits under GPO | **Moot** — Windows is out of scope (ADR-023) | — | Windows enters scope |
| GAP-04 | gVisor/Firecracker behaviour | **Moot** — deferred placements | — | An untrusted repo enters scope (§14) |
| GAP-05 | Telemetry default | **Local only.** ADR-018 stands; in practice M1–M5 write structured local logs and **no OTel at all** `[J]` | An OTLP pipeline is infrastructure to maintain, not insight to gain | You want traces across many sessions |
| GAP-06 | Licence | **Apache-2.0.** ADR-021 stands; `LICENSE` is in the repo | — | — |
| GAP-07 | In-process JS plugins | **No plugin system of any kind.** Not out-of-process either `[J]` | ADR-023 defers executable plugins, and a worker thread is not a security boundary. Skills, if wanted, are markdown read as text | You want third-party extensions, which means designing the boundary first |
| GAP-08 | Statistical power for experiments | **Moot** — no experiments | — | — |
| GAP-09 | Is `brush-core` enough bash? | **Deferred.** Real `/bin/zsh` and `/bin/bash` inside Seatbelt, with host-side decomposition and the sandbox as backstop | The interpreter's main prize was native Windows, which we no longer want | Command-parsing gaps become the actual source of bugs |
| GAP-10 | Journal encryption at rest | **Off.** ADR-022 stands | Transcripts sit beside the source they describe | You put the journal somewhere the source isn't |
| GAP-11 | Provider-native compaction elsewhere | **Moot** — Chat Completions only, so compaction is client-side by definition | — | You add a native adapter |
| GAP-12 | Windows share of audience | **Moot** — audience is you | — | — |

### 2.2 Resolved from the blocker list

| Was | Question | **Decision** |
|---|---|---|
| B1 | Telemetry / licence / encryption | Closed by ADR-018, ADR-021, ADR-022 |
| B2 | Hashline anchoring in v1? | **No.** Out of scope (GAP-01) |
| B3 | In-process JS plugins? | **No plugins at all** (GAP-07) |
| B4 | Which model families, what budget? | **One configurable OpenAI-compatible endpoint** — base URL, model id, credential reference (ADR-023). Every test uses the fake provider; **the test suite must cost nothing to run** |
| B5 | Experiment artifact storage | **Moot.** Ad-hoc run output goes to `runs/`, git-ignored |
| B6 | Managed Windows VM for the GPO spike | **Moot** — Windows out of scope |
| B7 | Apple/Windows signing certificates | **Deferred.** No public distribution; you run it from a local build. No notarization, no SBOM gate, no install channels `[J]` |
| B8 | Is the other agent good at Rust? | **Moot** — one developer, no delegation model |

### 2.3 Decisions this plan adds `[J]`

| # | Decision | Why | Reverse when |
|---|---|---|---|
| D-01 | **Tool networking is disabled outright.** The sandbox denies the stub all network access; there is no egress proxy and no allowlist in this release | ADR-023 is right that a proxy cannot inject credentials into an opaque TLS tunnel. "Off" is honest, testable in one line, and removes the whole secret-brokering subsystem. The host still makes its own inference calls | You need `git fetch` or a web-fetch tool, at which point the proxy is designed properly |
| D-02 | **No TUI at all in this release.** A plain streaming CLI is the only surface | The TUI is the largest single chunk of work in the archived plan and teaches the least about agent design. ADR-023 defers it | M5 is done and the CLI is the thing annoying you |
| D-03 | **No app-server, ACP, MCP or `dyn`** in this release | Each is a protocol surface with no second party to talk to yet | You want to drive om-code from an editor |
| D-04 | **No Directors, no subagents, no fork/rewind.** Resume only | Directors are a genuinely interesting primitive with no reference implementation — which makes them a poor thing to build before the loop underneath them works | The loop is solid and you want to study loop control |
| D-05 | **Journal entries are typed per kind, not a generic patch algebra** | The generalized entity-patch model pays off for rewind/fork, which are deferred. A typed append is simpler to get right and can grow into the general form | Fork/rewind enter scope |
| D-06 | **No SQLite, no projections, no FTS.** Read the journal | Sessions are small at this scale; an index is a second source of truth to keep consistent | Session listing becomes visibly slow |
| D-07 | **No Python, no `uv`, no Harbor, no `evals/`** | Nothing left in scope needs them (ADR-023) | Benchmarking enters scope |
| D-08 | **Milestones, not weeks.** No dates, no velocity, no burndown | Solo learning pace is not schedulable, and a missed date is noise, not signal | Never |
| D-09 | **Model tools are read-only until the policy engine exists.** The model gets `read`/`grep`/`glob` (M2) before it gets `edit`/`write`/`bash` (M3, after policy) | ADR-023: policy precedes executable model tools. It is also the only ordering where an early bug is harmless | Never — this is a safety ordering |
| D-10 | **Crash reconciliation never re-runs a command.** On resume, an operation whose outcome is unknown is reported as unknown and left to you | ADR-023, and repeating an arbitrary command is how a crash becomes two deployments | Never |

---

## 3. Scope

**In scope (the learning release, M1–M5).** macOS arm64 · CLI only · one OpenAI-compatible endpoint ·
Rust executor stub under Seatbelt · JSONL journal + resume · `read`/`grep`/`glob`/`edit`/`write`/`bash`/`todo`
· capability-based policy with read-only and manual modes · approvals in the terminal · checkpoints
before edits · central output/time/turn bounds · client-side context compaction · structured local logs.

**Out of scope (not built, not stubbed, not designed around).** Every non-macOS platform · TUI ·
app-server · ACP · MCP · `dyn` catalog · plugins and hooks · Directors · subagents · fork/rewind ·
SQLite projections · egress proxy and secret brokering · OTel export · experiments and benchmarks ·
signing, notarization, packaging and install channels · multi-tenancy · web UI.

**Deferred with re-entry conditions.** See §14. The distinction matters: out-of-scope items are ones
you would need a reason to build; deferred items are ones with a known trigger.

---

## 4. Functional requirements — `LR-FR-*`

Priority: **C** must exist for the release to mean anything · **H** the release is weak without it ·
**M** nice, drop it without guilt. Each requirement names the milestone that delivers it and the
observable that proves it.

### Foundation — schemas, journal, provider, loop

| ID | Requirement | Pri | Done when |
|---|---|---|---|
| **LR-FR-001** | **Wire contracts.** One schema source (`packages/protocol`, Zod) for the journal envelope, session entries, `CapabilityRequest` and every stub RPC message. Rust DTOs are generated or schema-checked mirrors, never hand-maintained twins | C | A round-trip test serializes every message type in TS, deserializes in Rust, returns it, and fails on any field mismatch |
| **LR-FR-002** | **Session journal.** Append-only JSONL per session with monotonic `seq`, `fsync` at defined commit points, an advisory lock giving one writer per session, and a corrupt-tail repair that truncates to the last valid record and journals the repair | C | Property test: append → read → materialize is stable for random op sequences. A second writer on the same session fails fast with a clear message. Kill -9 at the LRN-40 points loses no committed record |
| **LR-FR-003** | **Resume.** `om resume <id>` materializes the session and continues. Any operation that was in flight is marked `unknown` and surfaced, never retried (D-10) | C | Kill mid-tool-call; resume; the transcript shows the unknown outcome and asks you what to do |
| **LR-FR-004** | **Fake provider.** A deterministic provider that replays scripted turns, including tool calls, malformed arguments and error injection | C | The whole test suite runs with no network and no credentials |
| **LR-FR-005** | **CLI.** `om run` as an **interactive multi-turn REPL** (history, Ctrl-C, Ctrl-D) and `-p` as one-shot; `om resume`, `om sessions`, `om show`, `om doctor`; stable exit codes 0 ok, 1 error, 2 needs-approval, 3 limit, 4 denied | C | Codes 0/1/3 asserted in M1; 2 and 4 in M3 once policy can produce them. A scripted REPL session completes three turns without restarting the process |
| **LR-FR-036** | **Configuration.** `~/.om-code/config.json` plus environment overrides for endpoint base URL, model id and credential reference, with project-tier overrides. The credential is read from the environment or the macOS keychain and is never written to disk by us. `om config print --effective --with-sources` shows where each value came from | C | Every setting resolves through one loader; a test asserts tier precedence |
| **LR-FR-037** | **Prompt assembly.** One module builds the request: identity and behavioural rules, environment facts (cwd, OS, date), instruction files, conversation, and the tool schemas. Nothing else may append to the system prompt | C | A snapshot test shows the exact assembled prompt. **This is the file that most determines whether the agent is any good — keep it readable** |
| **LR-FR-006** | **Boundary lint.** Importing `child_process` or writing to the filesystem anywhere outside `packages/stub-client`, `packages/storage` and `native/` is a build error. `storage` may write only application-owned state (config, journals, locks, backups) — never workspace paths | C | A planted violation in each of the two categories fails the lint run |

### Boundary — the port, the stub, the sandbox

| ID | Requirement | Pri | Done when |
|---|---|---|---|
| **LR-FR-007** | **Executor stub.** A Rust process speaking the typed RPC over stdio: `health`, `exec`, `read`, `write`, `stat`, `glob`, `grep`, `batch`. Every request carries `{maxBytes, maxMs, cwd, envAllowlist}`; every response ends with `{status, bytes, truncated, elapsedMs}` | C | Contract tests from the TS side; version mismatch is refused at handshake |
| **LR-FR-008** | **Path containment.** All filesystem ops are handle-based: canonicalize → verify inside root → open → re-verify → act. Writes are atomic (temp + rename) and preserve line endings, BOM and mode. Binaries are refused | C | `proptest` over symlinks, case-folding, unicode normalization and TOCTOU races finds no input that touches a path outside the root |
| **LR-FR-009** | **Bounded exec.** Spawn by program and argv (no implicit shell), stream output against byte and wall-clock budgets, kill the process tree on exhaustion | C | A process that ignores SIGTERM is still dead within 1 s |
| **LR-FR-010** | **Seatbelt placement.** The stub runs under a generated Seatbelt profile via `@anthropic-ai/sandbox-runtime`: read within the workspace, write within the workspace minus denied config paths, **no network at all** (D-01). If the profile cannot be enforced, startup fails — it never degrades to unsandboxed | C | `om doctor` reports the profile in force; enforcement failure is a refusal with a remediation message |
| **LR-FR-011** | **Config-path deny list.** `.git/hooks`, `.git/config`, `.mcp.json`, agent config directories and shell startup files are unwritable from the stub regardless of any user rule | C | Escape suite class: each path is attempted and blocked |
| **LR-FR-012** | **Escape suite.** Data-driven classes: write outside root, write to a denied config path, symlink escape, TOCTOU, network connect, budget overrun. Machine-readable report | C | All classes blocked on macOS arm64; the report names the profile it ran under |
| **LR-FR-013** | **Search.** `glob` and `grep` in the stub via the ripgrep crates, honouring `.gitignore` and the byte budget | H | Parity with `rg` on fixture repos for a pattern set |

### The loop — tools, policy, editing

| ID | Requirement | Pri | Done when |
|---|---|---|---|
| **LR-FR-014** | **Inference.** One OpenAI-compatible Chat Completions adapter behind a `ModelProvider` port: configurable base URL, model id and credential reference; streaming text and tool-call deltas; usage counters when the endpoint returns them, `unknown` when it does not — never inferred from the model name | C | Contract tests against recorded fixtures plus one live smoke run you perform by hand |
| **LR-FR-015** | **Capability model.** Every tool implements `plan(input) → CapabilityRequest` before `execute`. Policy evaluates capabilities, never tool names | C | A tool without a `plan()` cannot be registered — enforced by the type system |
| **LR-FR-016** | **Policy engine.** Modes `read_only` and `manual`. Precedence `deny > ask > allow`; tiers user > project > session. Evaluation errors fail closed. Unknown or unparsed input escalates to `ask` | C | Exhaustive unit matrix over mode × capability class × tier |
| **LR-FR-017** | **Approvals.** The prompt shows the tool, the capability summary (read / write / execute / paths), a diff for edits, and the reason. Decisions are `once` or `session`, and every decision is journaled with who decided and why | C | Non-interactive runs never prompt: they exit 2 with a resumable needs-approval payload |
| **LR-FR-018** | **Shell decomposition.** A shell string is split per subcommand (`&&`, `\|\|`, `;`, `\|`, `$()`, backticks, leading assignments) into separate capabilities. **Any construct the parser does not fully understand escalates to `ask`** — the sandbox is the backstop, not the parser | C | Property test attempts to smuggle an effect past the decomposer; every miss must land on `ask`, never `allow` |
| **LR-FR-019** | **Kernel loop.** An explicit turn state machine — build context → infer → stream → tool requested → policy → (approval) → execute → process result → yield — with every transition journaled and illegal transitions unrepresentable | C | State-machine tests; a transcript replays the same tool sequence |
| **LR-FR-020** | **Tool roster (exactly 7).** `read`, `grep`, `glob`, `edit`, `write`, `bash`, `todo`. Read-class tools are wired first; `edit`/`write`/`bash` only after LR-FR-016 exists (D-09) | C | Roster size is asserted by a test, so adding an eighth is a deliberate act |
| **LR-FR-021** | **Exact editing.** `str_replace` with a uniqueness check and a whitespace-tolerant fallback used only when the match is unique. On failure, return nearest candidates with line numbers and change nothing | C | A 40-case fixture set including CRLF, BOM, deep indentation and near-duplicate anchors; ≥ 95% apply rate, 0 wrong-location applications |
| **LR-FR-022** | **Checkpoints.** Content-addressed snapshot of each file before it is written; `restorable: false` when links were skipped; restore refuses a non-restorable checkpoint with an explanation rather than half-rolling back | H | Restore round-trips on the fixture repos |
| **LR-FR-023** | **Central bounds.** The runtime — not any tool — truncates results, records a structured notice and spills the remainder to a blob. Turn count, wall-clock and total bytes are enforced in one module | C | A 100 MB tool output cannot exceed its context budget; fuzzed |
| **LR-FR-024** | **Repository discovery.** Git root, worktrees, ignore rules, and instruction files (`AGENTS.md`, then `CLAUDE.md`), journaled by content hash | H | Validated against fixture repos including a monorepo |

### Usable — context, cancellation, hygiene

| ID | Requirement | Pri | Done when |
|---|---|---|---|
| **LR-FR-025** | **Context accounting.** Tokens per component — system prompt, instructions, tool schemas, conversation, tool results by age, reserved output — visible via `om context` | H | Within 2% of the endpoint's reported prompt tokens on fixtures |
| **LR-FR-026** | **Compaction.** Client-side: evict oldest tool results to placeholders first, then summarize into a structured record appended to the journal. **The journal is never rewritten.** A thrash guard stops after K attempts and tells you | H | A long scripted session crosses the threshold and keeps working; the summary record is a provable fold of what it covers |
| **LR-FR-027** | **Argument repair.** Malformed tool arguments get JSON repair and dialect tolerance; genuinely ambiguous input becomes a structured retryable error, not a guess | H | Fixture set of malformed calls from real endpoint behaviour |
| **LR-FR-028** | **Cancellation.** Ctrl-C kills in-flight stub work and leaves the session resumable | H | Kill lands within 1 s; the journal shows a cancelled tool call, not a dangling one |
| **LR-FR-029** | **Session log and replay.** `om show <id>` renders a session from its journal; `om replay <id>` reconstructs the tool sequence deterministically without calling any provider | H | Replay reproduces the tool sequence exactly |
| **LR-FR-030** | **Secret hygiene.** Credentials are read from the environment or the macOS keychain by the host only. They never enter the stub's environment, the journal, a log line or a tool result | C | A scanner over e2e artifacts finds no key material; the stub's environment is asserted to be an explicit allowlist |
| **LR-FR-031** | **`om doctor`.** Checks toolchain versions, stub binary version, sandbox enforceability, config validity and endpoint reachability, printing a remediation for each failure | M | Each check has a failing-case test |

### Later — optional, only if you want to keep going

| ID | Requirement | Pri |
|---|---|---|
| **LR-FR-032** | Ink TUI over the same snapshot the CLI renders, under the component contract (no ANSI strings from anything but the renderer; all external text sanitized first) | M |
| **LR-FR-033** | MCP client (stdio) for one real server | M |
| **LR-FR-034** | OTel traces for turns and tool calls | M |
| **LR-FR-035** | Directors (plan / goal / force-tool) as a journaled stack | M |

---

## 5. Non-functional requirements — `LR-NFR-*`

Nine, all checkable on one machine. Every number is a **target to measure and record**, not a
promise — if reality differs, write down reality and adjust the target.

Every NFR names the task that owns it, so none of them is everyone's job and therefore nobody's.

| ID | Area | Requirement | How you check it | Owned by |
|---|---|---|---|---|
| **LR-NFR-001** | Boundary | 100% of escape-suite classes blocked on macOS arm64; zero filesystem or process access from `packages/**` outside the allowed modules | Escape suite + architectural lint | LRN-14, LRN-34 |
| **LR-NFR-002** | Durability | No committed journal record lost across ~20 SIGKILL injections at meaningful points; resume ≤ 2 s | Crash-injection harness | LRN-40 |
| **LR-NFR-003** | Context safety | No tool result exceeds its byte budget in context — hard invariant, zero violations | Fuzz with a large output | LRN-19 |
| **LR-NFR-004** | Policy | No capability reaches execution without a decision; unknown always escalates to `ask` | Policy matrix + decomposition property test | LRN-21c, LRN-21d, LRN-27 |
| **LR-NFR-005** | Privacy | Zero secrets in journals, logs or blobs across the e2e suite; content logging off by default | Automated scanner | LRN-41 |
| **LR-NFR-006** | Cost | The test suite spends nothing and makes no network call. Live runs respect `--max-turns` and the wall-clock cap; `--max-cost` only when pricing is configured and usage is reported (§8.1) | Fake provider by default; a test that fails if any suite process opens a socket | LRN-08, LRN-19 |
| **LR-NFR-007** | Responsiveness | Startup ≤ 800 ms; added per-tool-call driver overhead ≤ 25 ms p95 **(targets to measure and record, not promises)** | `om doctor --bench` prints both numbers | LRN-35 |
| **LR-NFR-008** | Maintainability | Provider names appear zero times in `packages/kernel`; OS access appears zero times outside `stub-client`/`storage`/`native`; one schema library; no platform branching in ports | `dependency-cruiser` + grep lint in CI | LRN-14, LRN-15 |
| **LR-NFR-009** | Test health | The suite runs offline in under 3 minutes. Coverage is **reported, not gated** — read it, don't chase it | CI timing; coverage printed per run | LRN-15 |

Dropped from the archived plan and why: accessibility (no UI), CI speed matrix and flake budget (one
runner), reproducibility by a second operator (no second operator), binary size and supply-chain
gates (no distribution), migration compatibility (no released version to migrate from — revisit at M5
if journals you care about exist).

---

## 6. Architecture in one page

Full reasoning lives in the [architecture document](docs/coding-agent-harness-final-architecture.md); this
is the shape you need in your head while working.

```
        you ──▶ om CLI ──▶ Runtime (trusted, TypeScript)
                              ├── kernel FSM ......... turn lifecycle
                              ├── session + journal .. the truth
                              ├── policy ............. capabilities → allow/ask/deny
                              ├── context ............ budgets, bounding, compaction
                              ├── provider ........... OpenAI-compatible Chat Completions
                              └── tools .............. plan() then execute() via the stub
                                        │
                                        │ typed, bounded RPC — the only door
                                        ▼
                              Executor stub (Rust) under macOS Seatbelt
                                        │  read/write/exec/search, no network
                                        ▼
                                    your repository
```

**The rule that makes it work:** the host decides, the stub executes. Everything that knows anything —
your prompts, the journal, the policy, the credentials — stays on the trusted side. The stub is
obedient and ignorant. If it is compromised, the attacker has a shell in a sandbox with no network and
a copy of a repo they could already read.

**Packages** (`packages/`, per [AGENTS.md](AGENTS.md)):

| Package | Owns | Must not know about |
|---|---|---|
| `protocol` | Every wire schema; the authority | anything |
| `kernel` | FSM, turn lifecycle, ports | providers, sandbox, fs |
| `session` | Entry types, journal apply/materialize | surfaces |
| `storage` | Journal files, blobs, config, locks (host-owned state only) | workspace paths |
| `policy` | Capability evaluation, rules, tiers, modes | tool internals |
| `providers` | The OpenAI-compatible adapter | kernel internals |
| `context` | Accounting, bounding, compaction | providers |
| `tools` | The seven tools; `plan()` + `execute()` | the OS |
| `patch` | The `str_replace` engine — pure string logic | the OS, the journal |
| `stub-client` | The port, its drivers, and the only module that spawns a process | policy |
| `sandbox` | Placement port + the Seatbelt driver | tools |
| `cli` | Composition and rendering | everything else's internals |

**Two drivers sit behind the `stub-client` port, and only ever two:** `local-ts` (an in-process
TypeScript implementation, built in M2, retained afterwards as the test fake) and `stub-rpc` (the
sandboxed Rust process, built in M4). Both pass the same exported driver contract suite. Tools never
learn which one is active — that is the property M4's exit gate measures.

**Native** (`native/`): `om-stub` (the executor) and `om-stub-protocol` (mirrored wire types). The
patch engine is **not** native: it is pure string manipulation with no OS access, so Rust buys nothing
and costs a toolchain round trip on the code you will iterate on most.

**Dependency direction.** `protocol` ← {`session`, `policy`} ← `kernel` ← {`providers`, `tools`,
`stub-client`, `sandbox`, `storage`, `context`} ← `cli`. Enforced in CI.

---

## 7. Data model

One session is one JSONL file. Records append; nothing is ever rewritten (LR-FR-002).

```ts
type Record = {
  v: 1;
  seq: number;              // strictly increasing
  id: string;               // UUIDv7
  ts: string;               // RFC 3339
  by: "user" | "model" | "system" | `tool:${string}`;
  turn_id?: string;
  entry: Entry;
  sha256: string;           // integrity of `entry`
};

type Entry =
  | { kind: "session_start"; meta: SessionMeta }
  | { kind: "user_message"; text: string }
  | { kind: "assistant_message"; content: Block[]; usage: Usage; stop_reason?: string }
  | { kind: "tool_call"; ...ToolCall }
  | { kind: "tool_result"; call_id: string; preview: string; blob_ref?: string;
      truncated: boolean; bytes: number; status: ToolStatus }
  | { kind: "permission"; call_id: string; decision: "allow" | "deny";
      scope: "once" | "session"; decided_by: "user" | "rule" | "timeout"; reason: string }
  | { kind: "checkpoint"; files: FileSnapshot[]; restorable: boolean }
  | { kind: "compaction"; covers: { from: number; to: number }; summary: StructuredSummary }
  | { kind: "repair"; reason: string; truncated_from: number }
  | { kind: "turn_end"; usage: Usage; cost_usd?: number };
```

`ToolStatus` includes **`unknown`** — the state a call enters when the process died between its effect
and its durable result (D-10). Resume surfaces it; nothing re-runs it.

**Storage layout.**

```
~/.om-code/
  config.json                       # user-tier settings
  sessions/<project-hash>/<id>.jsonl
  blobs/sha256/ab/…                 # spilled results, checkpoint file contents
  logs/
<project>/.om-code/settings.json       # project-tier settings
```

`StructuredSummary` (used by compaction): `goal`, `decisions`, `constraints`, `changed_files`,
`tests`, `failed_attempts`, `approved_permissions`, `open_questions`, `next_steps`.

---

## 8. Contracts

### 8.1 CLI

| Command | Behaviour |
|---|---|
| `om run [-p <prompt>]` | Interactive multi-turn REPL by default; `-p` is one-shot. `--max-turns`, `--max-cost`, `--mode read_only\|manual`, `--json` |
| `om resume <id>` | Continue a session; reconcile unknown outcomes first |
| `om sessions` | List sessions for this project with status and last activity |
| `om show <id>` | Render a session from its journal |
| `om replay <id>` | Reconstruct the tool sequence with no provider calls |
| `om undo` | Restore the files changed by the last edit from its checkpoint |
| `om context` | Token accounting for the active session, per component |
| `om doctor` | Environment, sandbox enforceability, endpoint reachability |
| `om config print --effective --with-sources` | Which setting came from which tier |

Exit codes: `0` success · `1` error · `2` needs approval (resumable) · `3` limit exceeded · `4` denied.

**On `--max-cost`.** Cost is not knowable from an OpenAI-compatible endpoint generically: many report
no `usage`, and none report price. So `--max-cost` is enforced **only** when `pricing.inputPerMTok`
and `pricing.outputPerMTok` are configured for the active model *and* the endpoint returns usage. When
either is missing, cost is reported as `unknown`, `--max-cost` is rejected at startup with that reason,
and `--max-turns` plus the wall-clock cap remain the effective budget. Do not silently estimate.

### 8.2 Stub RPC

JSON-RPC 2.0 over stdio. Every request carries `{maxBytes, maxMs, cwd, envAllowlist, capability}`;
every response ends `{status, bytes, truncated, elapsedMs}`.

| Method | Purpose |
|---|---|
| `health` | Version, sandbox profile in force, enforcement status — used to fail closed at startup |
| `exec` | Program + argv, no implicit shell |
| `shell` | Shell string, only after host-side decomposition; refuses if any subcommand was unplanned |
| `read` · `write` · `stat` | Handle-based, containment-verified, atomic writes |
| `glob` · `grep` | ripgrep engine, ignore-aware |
| `batch` | Ordered ops in one round trip, stopping at first failure with per-op results |

Deferred: `patch`, `script`, `watch`, `job/*`. Add them when a requirement needs them, not before.

### 8.3 The two interfaces to freeze early

Get these right early — the `Tool` shape in M2, the capability shape before policy in M3. Everything else can move.

```ts
interface Tool {
  descriptor(): ToolDescriptor;
  plan(input: unknown, ctx: ToolContext): Promise<CapabilityRequest>;
  execute(input: unknown, io: StubClient, ctx: ToolContext): AsyncIterable<ToolEvent>;
}

interface CapabilityRequest {
  process?: { program: string; argv: string[]; cwd: string; shell?: "bash" | "zsh" };
  filesystem?: { read: string[]; write: string[] };
  network?: never;                    // disabled in this release (D-01)
  risk_class: "read" | "write_workspace" | "exec" | "destructive";
}
```

---

## 9. Security model

**In scope.** A model that has been talked into doing something destructive by content it read —
from your repository, from command output. That is the realistic threat on a trusted machine, and the
boundary, not the prompt, is the control.

| # | Threat | Control |
|---|---|---|
| T1 | Prompt injection → destructive or exfiltrating action | Stub executes only bounded, planned requests; destructive class always asks; **no network from the stub at all** (D-01) |
| T2 | Sandbox persistence via config files | Config-path deny list holds regardless of user rules (LR-FR-011) |
| T3 | Path escape / TOCTOU | Handle-based resolution, re-verified after open, property-tested (LR-FR-008) |
| T4 | Credential leakage | Host-only credentials; explicit env allowlist for the stub; redaction before anything is journaled (LR-FR-030) |
| T5 | Runaway cost or looping | Central turn, wall-clock, byte and cost caps (LR-FR-023) |
| T6 | Unbounded output filling context | Central bounding with blob spill (LR-NFR-003) |

**Accepted limitations — state them, don't design around them.**

- **Untrusted repositories are out of scope.** Seatbelt is the only isolation available, and it is not
  what you want against a repo that may attack the host. That needs a VM (§14).
- **Unattended runs are out of scope.** No `auto` or `bypass` mode ships. `read_only` and `manual` only.
- **No local listener exists,** so the whole class of local-server attacks is absent rather than
  mitigated — which is the reason not to add one casually later.
- **A green escape suite proves those classes were blocked on that profile on macOS arm64.** It is not
  a proof of sandbox safety.

---

## 10. Testing

The point is fast, offline, and honest.

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest | Pure logic: policy evaluation, decomposition, accounting, journal folds |
| Property | fast-check (TS), `proptest` (Rust) | Path containment, journal materialization, shell decomposition |
| Contract | Vitest | TS ↔ Rust round-trips; provider adapter against recorded fixtures |
| Integration | Vitest + fake provider | Whole turns end to end with no network |
| Escape | Custom harness | The six boundary classes (LR-FR-012) |
| Crash | Custom harness | 200 kill points; resume integrity |
| Manual | You | One live endpoint smoke run per milestone, written down |

**Rules.** Every behavioural fix gets a regression test named for its issue. Security-sensitive changes
under `native/`, `packages/policy`, `packages/sandbox` or `packages/stub-client` also run the escape
suite. The default suite uses the fake provider and must never spend credits. Never re-run an arbitrary
command with an unknown outcome to "see what happens".

**Cover deliberately:** stale edits (file changed since read), approval invalidation (input changed
after approval), truncated tool streams, unknown usage fields, cancellation mid-stream, and a crash
between a tool's effect and its durable result.

---

## 11. Milestones

Five milestones. Each ends with a demonstration you can run from a terminal — if you cannot demo it,
it is not done. No dates (D-08). The [backlog](docs/om-code-agent-execution-backlog.md) is the authority on
task order; this section is the authority on what each milestone must prove.

**The honest order of value: M1–M3 give you a working coding agent. M4 makes it safe to trust. M5
makes it pleasant.**

### M1 — "It talks" · *a journaled conversation with a real model*

Endpoint spike first · config · protocol schemas · journal · provider adapter · fake provider ·
**prompt assembly** · turn loop with no tools · CLI with streaming output.

**Exit gate.** `om run -p "hello"` against your real endpoint streams an answer, writes a journal, and
`om show` reads it back.

**Requirements:** LR-FR-001, 002, 004, 005, 014, 019, 036, 037.

### M2 — "It reads your code" · *the agent answers questions about your repo*

The stub **port** · a TypeScript implementation behind it with path containment and budgets · boundary
lint · tool interface with `plan()` · read/grep/glob tools · multi-tool turn · central bounding ·
repository discovery.

The port arrives here and is never bypassed again. What prevents a tool from touching the OS directly
is the port plus the lint — not the sandbox, which arrives in M4 behind the same interface.

**Exit gate.** `om run -p "where is auth handled?"` gives a correct answer on a real repository of
yours, having searched and read files, and provably cannot change anything.

**Requirements:** LR-FR-006, 007 (TS implementation), 008 (basic containment), 013, 015, 020 (read
half), 023, 024 · LR-NFR-003, 008.

### M3 — "It asks, then edits" · *a working coding agent*

Policy engine · approvals · `str_replace` engine and its fixtures · checkpoints · `edit`/`write` tools
· shell decomposition and `bash` · `todo` · resume with reconciliation.

**Ordering inside this milestone is a safety property (D-09): policy lands before write tools.**

**Exit gate.** On a real repository in `manual` mode, the model proposes an edit, you see the diff and
the capability summary, you approve, and it applies exactly — with the decision in the journal. A
command with an unparsed construct escalates to `ask`. A piped run exits 2 instead of prompting.

**Requirements:** LR-FR-003, 009, 016, 017, 018, 020 (write half), 021, 022 · LR-NFR-004, 006.

### M4 — "It's contained" · *the boundary becomes real*

Rust stub replacing the TypeScript one behind the same port · path-containment property tests ·
Seatbelt placement with no network and fail-closed startup · config-path deny list · escape tests ·
`om doctor`.

**Nothing here is optional.** Until M4 lands, `om` edits files on your machine with your approval and
nothing stopping it if you approve carelessly. That is a reasonable place to be for a while; it is not
a reasonable place to stay — and it is exactly why §9's "untrusted repositories are out of scope" is
not a formality during M1–M3.

**Exit gate.** Every M2 and M3 test still passes with the Rust stub swapped in and **no change to any
tool** — if a tool needed changing, the port leaked. Escape classes all blocked on macOS arm64 with a
report naming the profile. Startup refuses when the profile cannot be enforced.

**Requirements:** LR-FR-007 (Rust implementation), 008 (adversarial), 010, 011, 012, 031 ·
LR-NFR-001, 007.

### M5 — "It's usable" · *you reach for it without thinking*

Context accounting · compaction with a thrash guard · cancellation · argument repair from real
endpoint failures · crash recovery · secret hygiene and local logs · then two weeks of real use, fixing
what annoys you.

**Exit gate.** You complete a real multi-file change on one of your own repositories without dropping
to manual editing in frustration. A long session crosses the compaction threshold and keeps working.
Ctrl-C always leaves you resumable.

**Requirements:** LR-FR-025, 026, 027, 028, 029, 030 · LR-NFR-002, 005, 009.

### Later — optional

TUI · MCP client · Directors · fork/rewind · V4A · OTel. Pick one because you want to learn it, not
because the plan says so (LR-FR-032…035, §14).

---

## 12. Working rhythm for one developer

No PR reviewers exist, so the discipline has to come from somewhere else: the tests and the checklist.

**Branches.** `feat/`, `fix/`, `docs/`, `spike/` + kebab-case, e.g. `feat/session-journal`. One branch
per LRN task or per tight group. Merge to `main` yourself when the checklist passes.

**Commits.** Conventional Commits with the task id: `feat(session): append-only journal with fsync
commit points (LRN-012)`. Commit when a test passes, not when a file is saved.

**Self-review checklist** — run before merging anything:

1. Does it do what the requirement said, or what I found easier?
2. What's the failure mode, and is there a test for it?
3. Did I widen the boundary? (Any new spawn, write, or network path outside the allowed modules?)
4. Is the new state in the journal, or hiding in a module variable?
5. Did I claim anything I didn't run?

**Evidence.** For security-relevant work, paste the escape-suite report into the commit body. For
performance claims, paste the measured number. "Should be fine" is not evidence.

**Spikes.** Timebox, learn, then throw the code away and write it properly. A spike that merges is not
a spike.

**When stuck.** Ship the smaller version. This is a learning project; a working `str_replace` teaches
more than an unfinished patch-engine framework.

---

## 13. Risks

Short list, because a solo project's real risk is scope, not systems.

| # | Risk | Likelihood | Mitigation | Early signal |
|---|---|---|---|---|
| R1 | **Scope creep back toward the archived plan** — the deferred list is full of interesting things | High | §14 requires a written trigger before anything re-enters. The roster size is a test | You are building a protocol surface with no second party |
| R2 | Boundary erodes — one "small" host-side `exec` for convenience | Medium | Lint in M2, while there are three files to fix | A lint suppression appears |
| R3 | The endpoint doesn't behave like the spec (usage fields, tool-call dialects, streaming quirks) | High | Assume nothing from the model name; `unknown` is a valid answer; argument repair (LR-FR-027) | Fixture drift after an endpoint change |
| R4 | Seatbelt is deprecated by Apple | Low, high impact | Placement port means one driver changes; §14 has the exits | Deprecation notice in a macOS release |
| R5 | The loop works but is unpleasant, so you stop using it | Medium | M5's exit gate is deliberately subjective: *would you reach for it* | You keep editing by hand mid-session |
| R6 | Two toolchains slow you down more than expected | Medium | The Rust surface is one small binary with a fixed RPC. If it stalls, a TypeScript stub behind the same port is an acceptable temporary step | `native/` work repeatedly stalls a milestone |

---

## 14. Deferred scope register

Not "never" — "not now, and here is exactly what would change my mind".

| Deferred | Re-enters when | Cost when it does |
|---|---|---|
| Linux or Windows | You want to run it on another machine you own | One placement driver, one shell provider, that platform's escape suite, a second CI target |
| Container / microVM placement | You want to point it at a repository you don't trust, or run unattended | A placement driver plus an honest re-read of §9 |
| Egress proxy + secret brokering (D-01) | A tool genuinely needs the network (`git fetch`, web fetch) | Proxy, allowlist, escalation on new domains — and a real answer to the TLS problem ADR-023 raised |
| TUI (D-02) | M5 is done and the CLI is the thing annoying you | Ink app shell, component contract, sanitization layer, transcript lifecycle |
| MCP / ACP / app-server (D-03) | You want to drive om-code from an editor, or give it real tools | One protocol at a time, each with interop tests |
| Directors, subagents (D-04) | The loop is solid and loop control is the next thing to learn | Journaled director stack; rewind semantics come with it |
| Fork / rewind (D-04, D-05) | You want to explore alternatives from a mid-session point | Generalized entity patches — the reason D-05 keeps the door open |
| SQLite projections (D-06) | Listing or searching sessions is visibly slow | Schema, folds, a rebuild command that must match the incremental path |
| Plugins and hooks (GAP-07) | You want extensions | Out-of-process host with a capability-scoped API — the boundary work ADR-023 refused to fake |
| Experiments, Harbor, benchmarks (D-07) | You want to make a defensible claim about a design choice | Python toolchain, pre-registration, and an inference budget |
| Signing, notarization, packaging (B7) | Someone other than you runs it | Certificates, release pipeline, SBOM, source-map gate |
| V4A `apply_patch` (GAP-01) | You adopt an OpenAI model trained on it | Parser, applier, fuzzing |
| In-process bash interpreter (GAP-09) | Command parsing becomes your actual bug source | `brush-core` spike against a golden corpus, ≥ 95% gate |

---

## 15. Decision record index

| ADR | Decision | Status for this release |
|---|---|---|
| [ADR-018](docs/adr/ADR-018-telemetry-default.md) | Telemetry local-first, export opt-in | Stands; no OTel is built at all in this release (GAP-05) |
| [ADR-021](docs/adr/ADR-021-product-licence.md) | Apache-2.0 | Stands |
| [ADR-022](docs/adr/ADR-022-journal-encryption-at-rest.md) | Encryption off by default | Stands; opt-in mode is not built |
| [ADR-023](docs/adr/ADR-023-macos-openai-compatible-learning-scope.md) | macOS + OpenAI-compatible first | **The scope authority for this document** |

Architecture decisions ADR-001…ADR-020 from the archived blueprint are *not* re-ratified here. The ones
still load-bearing are stated as decisions in the [architecture document](docs/coding-agent-harness-final-architecture.md):
host decides / stub executes, journal as single authority, capability-based policy, buy the sandbox
runtime, small tool roster, AI SDK for wire format. The rest — Directors, plugins, `dyn`, app-server,
speculative compaction, Ink — described things this release does not build; they return with their
feature, not before. **Write a new ADR when you make a real decision.** Next free number: **ADR-024**.

---

## 16. First five actions

Not ten. Five, in order, each finishable in a sitting.

| # | Action | Output |
|---|---|---|
| 1 | `git init`; add `.gitignore` (`node_modules`, `target`, `runs/`, `.om-code/`); commit the four planning documents as they stand | A repository with history, so the next rewrite is recoverable |
| 2 | Scaffold the workspace: pnpm workspace, Cargo workspace, `tsconfig.base.json` (strict, ESM, NodeNext), `biome.json`, `.tool-versions` | `pnpm install && cargo build` green on macOS arm64 |
| 3 | Add the boundary lint (`dependency-cruiser` + the spawn/fs rule) **with a planted-violation test that fails** | The rule is real before there is anything to violate it |
| 4 | Write `packages/protocol`: journal envelope, entries, `CapabilityRequest`, stub RPC — plus Rust codegen and the round-trip test | The one contract everything else depends on |
| 5 | Implement the journal in `packages/storage` with `fsync` commit points and corrupt-tail repair | The append/read/materialize property test passes |

**First commit:** `chore(repo): initialize pnpm and cargo workspaces with pinned toolchains`
**First real decision to make yourself:** where the journal's commit points sit. That choice is what
LR-NFR-002 measures, and it is the first place this design can be wrong in a way tests will catch.

---

*This is the current plan. The archived production blueprint is evidence, not obligation. When
something here turns out to be wrong — and some of it will — change this document and say why in the
commit.*
