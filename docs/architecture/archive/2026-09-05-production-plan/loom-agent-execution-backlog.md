# Loom — Multi-Agent Execution Backlog

**Source plan:** `loom-master-delivery-blueprint.md` (ENG-001…095) + `coding-agent-harness-final-architecture.md`
**Agents:** Claude Code (scarce, judgment) · Codex (scarce, spec-driven implementation) · OpenCode (abundant, mechanical)
**Sequencing rule:** ordered by dependency, not by agent. Waves may overlap where dependencies allow (noted per wave).

Legend — **⛔ BLOCKED**: needs a decision from you before the session starts (listed in §Blockers). **⚙ TEST-FIRST**: candidate for the budget-saving pattern in §Session budget.

---

## Backlog

| # | Task | Complexity | Agent | Why | Depends on | Status | Notes |
|---|---|---|---|---|---|---|---|
| **Wave 0 — Decisions & pre-registration** (parallel with Wave 1) |
| 1 | ⛔ Draft ADR-018 (telemetry default), licence decision record, journal-encryption ADR | High | Claude Code | Three coupled decisions that shape the config schema, LICENSE and privacy defaults; needs judgment, not typing | — | ✅ Complete | ADR-018, ADR-021, ADR-022, LICENSE created. Used decisions: telemetry opt-in, Apache-2.0, encryption off-by-default. |
| 2 | Research methodology doc + pre-registration template + EXP-01…04 pre-registrations | High | Claude Code | Statistical design, thresholds and falsifiability; a bad pre-registration invalidates the study | — | ✅ Complete | `docs/research/methodology.md`, `TEMPLATE.md`, `EXP-01.md`–`EXP-04.md` created. EXP-04 N marked "pending pilot" per GAP-08. |
| 3 | Fill EXP-05…08 pre-registrations from the template | Low | OpenCode | Template + blueprint §28.3 supply every field; pure transcription | 2 | Not Started | — |
| 4 | ⛔ Windows sandbox/GPO spike script + degradation report | Medium | Codex | Bounded systems investigation with a written deliverable; Rust/Win32 adjacent | — | Blocked | B6: Waiting for managed Windows VM |
| **Wave 1 — Foundation** |
| 5 | Workspace scaffolding: pnpm/turbo/cargo/uv, tsconfig, biome, .tool-versions | Low | OpenCode | Pure config transcription from blueprint §15 | — | Not Started | — |
| 6 | `packages/protocol`: Zod schemas for patch envelope, tree nodes, capability request, manifest | High | Claude Code | The one contract three languages share; getting field semantics wrong is the most expensive mistake in the plan | 5 | Not Started | — |
| 7 | Stub RPC wire schema + TS→Rust codegen + round-trip test | Medium | Codex | Mechanical but fiddly generation with an exact spec | 6 | Not Started | — |
| 8 | Biome + dependency-cruiser rules incl. spawn/fs ban outside `stub-client`, + planted-violation test | Medium | Codex | Enforces ADR-002 mechanically; needs precise rule authoring and a self-test | 5, 6 | Not Started | — |
| 9 | CI `pr.yml`: 3-OS matrix, caches, lint/typecheck/unit/build | Low | OpenCode | YAML from an explicit spec; iterates a lot, so spend the cheap agent | 5, 8 | Not Started | — |
| 10 | Journal writer/reader: append, fsync commit points, snapshot format, corrupt-tail repair | High | Claude Code | Durability semantics and commit-point placement are load-bearing for H3 and NFR-005 | 6 | Not Started | — |
| 11 | Experiment manifest validator + append-only index writer | Low | OpenCode | Schema fully specified in blueprint §29 | 6 | Not Started | — |
| **Wave 2 — Boundary** (the critical path; start as soon as 7 lands) |
| 12 | Stub skeleton: process, JSON-RPC framing, health/version handshake | Medium | Codex | Rust + protocol conformance, fully specified | 7 | Not Started | — |
| 13 | ⚙ Stub `exec`: argv spawn, byte/time budgets, streaming, kill | Medium | Codex | Budget enforcement semantics matter; spec is explicit | 12 | Not Started | — |
| 14 | Stub fs: handle-based read/write/stat, canonicalize→contain→re-verify, atomic write, EOL/BOM/mode preservation | High | Codex | Highest subtle-bug density in the codebase; Codex is strongest on precise systems code | 12 | Not Started | — |
| 15 | Path-containment property tests: symlink, junction, case-fold, unicode, TOCTOU | High | Codex | Must be written by someone thinking adversarially about the same code path | 14 | Not Started | — |
| 16 | Stub search: grep/glob via `grep-searcher`/`ignore`/`globset` + rg parity tests | Low | OpenCode | Crate wiring against a reference implementation | 12 | Not Started | — |
| 17 | Stub jobs + PTY: spawn/signal/attach/list | Medium | Codex | `portable-pty` integration with lifecycle edge cases | 13 | Not Started | — |
| 18 | Stub `batch` + `script` ops | Medium | Codex | Latency mitigation for ADR-002; needs care around partial failure | 13, 14 | Not Started | — |
| 19 | `stub-client` (TS): typed client, budget enforcement, stream framing, reconnect-once | Medium | Codex | Mirror of the Rust side; contract-tested against it | 7, 12 | Not Started | — |
| 20 | Placement driver: sandbox-runtime on macOS + Linux, profile generation, fail-closed startup | High | Claude Code | Security-boundary judgment; fail-closed semantics and profile scope are architectural | 19 | Not Started | — |
| 21 | Config-path deny list + egress proxy + allowlist + new-domain escalation | High | Claude Code | Where policy and boundary interact; the T2/T3 mitigations live or die here | 20 | Not Started | — |
| 22 | ⛔ Placement: Windows alpha (opt-in flag, documented exceptions) | Medium | Codex | Win32/restricted-token territory with a spike report to work from | 20, 4 | Blocked | B6 + task 4: Waiting for GPO spike |
| 23 | Placement: container driver with image-digest recording | Low | OpenCode | Same protocol, different spawn; mechanical | 20 | Not Started | — |
| 24 | `loom doctor` + startup enforceability checks | Medium | Codex | Cross-platform probing with clear remediation output | 20, 21 | Not Started | — |
| 25 | Escape suite: harness + 3 exemplar classes (outside-root write, egress, config-path) | High | Claude Code | Adversarial design; these three set the pattern and are the evidence for H1 | 21 | Not Started | — |
| 26 | Escape suite: remaining 5 classes + 3-OS wiring + report format | Low | OpenCode | Pattern established by 25; variants are repetitive | 25 | Not Started | — |
| 27 | EXP-01 + EXP-02 runners (boundary arms, manifests, latency bench) | Medium | Codex | Deterministic harness work with a fixed manifest contract | 11, 18, 26 | Not Started | — |
| **Wave 3 — Data layer** (parallel with Wave 2, different owner) |
| 28 | Session tree types + patch ops (create/set/append/delete/snapshot) + apply/diff | High | Claude Code | The single-authority model is the study's core claim; entity granularity is a design decision | 10 | Not Started | — |
| 29 | `state.declare()` journal-only state API + lint forbidding any other state channel | High | Claude Code | ADR-004 enforcement; the API shape decides whether H3 holds | 28 | Not Started | — |
| 30 | Snapshots + zstd + fast resume path | Medium | Codex | Well-specified serialization and cadence work | 28 | Not Started | — |
| 31 | rewind / fork / resume as tree diff-and-apply | High | Claude Code | Semantics (what a fork inherits, what resume re-verifies) are judgment calls | 29, 30 | Not Started | — |
| 32 | SQLite projections + FTS5 + `projections rebuild` | Low | OpenCode | DDL and folds fully specified in blueprint §17.4 | 28 | Not Started | — |
| 33 | Blob store + refcount GC + spill helpers | Low | OpenCode | Content-addressed store, mechanical | 28 | Not Started | — |
| 34 | Crash-injection harness (1,000 kill points) | Medium | Codex | Deterministic fault injection with tricky process orchestration | 30, 32 | Not Started | — |
| 35 | Adversarial test plugins + EXP-03 divergence runner | Medium | Codex | Needs plugins designed to break replay — mirrors the Pi failure taxonomy | 11, 31 | Not Started | — |
| **Wave 4 — Kernel & providers** |
| 36 | Kernel FSM: turn lifecycle, states, transitions, error and interrupt paths | High | Claude Code | Architecture-level; every later feature attaches here | 19, 28 | Not Started | — |
| 37 | Director stack + `prepare_inference`/`on_yield` + TodoReminder/Plan/Goal/ForceTool | High | Claude Code | Novel primitive with no reference implementation to copy; composition semantics are subtle | 29, 36 | Not Started | — |
| 38 | Budgets, cancellation, steering queue | Medium | Codex | Clear contract (kill ≤ 1 s p95), plumbing-heavy | 17, 36 | Not Started | — |
| 39 | `compat`: rule format (taxonomy/classes/providers) + compiler with ambiguity-as-build-error | High | Claude Code | Designing a small DSL and its precedence rules; wrong precedence silently mis-routes every model | 6 | Not Started | — |
| 40 | Provider port + Anthropic + OpenAI adapters (streaming, tools, usage/cache) | Medium | Codex | Two adapters establish the port; SDK-heavy and well-documented | 39 | Not Started | — |
| 41 | Google + OpenAI-compatible adapters on the same port | Low | OpenCode | Copy the established shape; contract tests already exist | 40 | Not Started | — |
| 42 | Native escape hatches: Anthropic compaction/context-editing/memory, OpenAI `apply_patch` plumbing | Medium | Codex | Capability-gated paths against precise API docs | 40 | Not Started | — |
| 43 | Argument repair + corrective inference (JSON repair, leaked-call parsing, repetition detection) | Medium | Codex | Parser-shaped work with clear pass/fail cases | 40 | Not Started | — |
| 44 | Mock provider + fixture recorder/replayer | Low | OpenCode | Record-and-replay plumbing; unblocks all CI | 40 | Not Started | — |
| 45 | **First vertical slice:** headless `run -p` with stream-json, exit codes, needs-approval payload | Medium | Codex | Integration of everything so far against an explicit CLI contract | 36, 40, 44 | Not Started | — |
| **Wave 5 — Tools & editing** |
| 46 | Tool interface + registry + `plan()` + reference tool `read` (ranges, formats, URI schemes) | High | Claude Code | Sets the pattern every other tool copies, including the capability-planning contract | 19, 45 | Not Started | — |
| 47 | Remaining roster tools: write, glob/grep wrappers, task, ask, todo | Low | OpenCode | Five tools following one established shape — exactly the repetitive case | 46 | Not Started | — |
| 48 | `str_replace` engine: uniqueness, tolerant fallback, candidates on failure | High | Codex | Precision-critical; the ≥ 98% corpus gate depends on the failure-reporting design | 46 | Not Started | — |
| 49 | V4A `apply_patch` parser/applier + fuzz | High | Codex | Format parser with an exact published grammar; fuzzing is essential | 48 | Not Started | — |
| 50 | ⛔ whole-file + hashline engines behind flags | Medium | Codex | whole-file is trivial; hashline is a novel anchoring scheme needing care | 48 | Blocked | B2: Hashline scope decision pending |
| 51 | Checkpoints: pre-write snapshots, `restorable` flag, restore command | Medium | Codex | Link/symlink edge cases decide correctness | 33, 48 | Not Started | — |
| 52 | bash/pwsh tool: shell selection, forced UTF-8 console, job wiring | Medium | Codex | Windows encoding and PS 5.1-vs-7 handling is finicky, well-documented work | 17, 46 | Not Started | — |
| 53 | Repository discovery + instruction-file loading (content-hashed) | Medium | OpenCode | Fixture-driven with five known repo shapes; low judgment | 46 | Not Started | — |
| 54 | LSP client + bounded post-edit diagnostics | Medium | OpenCode | Standard protocol, bounded scope, non-blocking by design | 48 | Not Started | — |
| 55 | Edit corpus: 300 edits × 8 languages + apply-rate harness | Low | OpenCode | Volume work; the definition of "repetitive" | 48, 49, 50 | Not Started | — |
| 56 | Pilot variance study → required N for EXP-04/05/06 | Medium | Claude Code | Statistical judgment that sets sample sizes for three experiments (closes GAP-08) | 55 | Not Started | — |
| **Wave 6 — Policy & approvals** |
| 57 | Capability evaluation engine + rule compiler (`Tool(pattern)` → predicates) | High | Claude Code | ADR-005; precedence and compilation semantics are security-critical architecture | 46 | Not Started | — |
| 58 | Tiers + managed immutability + settings precedence | Medium | Codex | Clear precedence table to implement and test exhaustively | 57 | Not Started | — |
| 59 | Shell decomposition + escalation invariant + property tests | High | Claude Code | "No allow on an unparsed expansion" is the invariant most likely to be subtly broken | 52, 57 | Not Started | — |
| 60 | Mode matrix wiring (plan/manual/accept_edits/auto/bypass) + exhaustive unit matrix | Low | OpenCode | The matrix is fully specified; transcription plus tests | 58 | Not Started | — |
| 61 | Approval routing + rule-preview equality + persistence scopes | Medium | Codex | Multi-surface plumbing with a strict byte-equality requirement | 45, 58 | Not Started | — |
| 62 | Hook bus + command/http/in-process handlers + decision protocol + output caps | Medium | Codex | Well-specified event surface modelled on documented precedent | 57 | Not Started | — |
| 63 | Workspace-trust gate + managed-hook immunity | Low | OpenCode | Small, well-bounded addition to 62 | 62 | Not Started | — |
| 64 | EXP-07 injection scenarios + runner | Low | OpenCode | Extends the escape harness with scenario data | 26, 59 | Not Started | — |
| **Wave 7 — Context** |
| 65 | Context accounting per component + `/context` data model | Medium | Codex | Token math with a ±2% accuracy target | 28, 40 | Not Started | — |
| 66 | Central output bounding + blob spill + `notrunc` opt-out | Medium | Codex | Hard invariant (NFR-009) enforced in one place | 33, 65 | Not Started | — |
| 67 | Eviction + fold model | Medium | Codex | Mechanical once folds are defined, but ordering matters | 66 | Not Started | — |
| 68 | Compaction: blocking + speculative branch/splice + native + thrash guard | High | Claude Code | Splice correctness against an append-only journal is the subtlest logic in the product | 42, 67 | Not Started | — |
| 69 | EXP-06 runner (3 arms, stall metric) | Low | OpenCode | Third runner following an established pattern | 11, 68 | Not Started | — |
| **Wave 8 — Surfaces** |
| 70 | Ink app shell: render-from-snapshot, patch subscription, component contract | High | Claude Code | The "views are projections" invariant and the component contract that prevents the string-pipeline trap | 45 | Not Started | — |
| 71 | Sanitization layer (ANSI/control strip) + semantic component set | Medium | Codex | Security-relevant parsing with a clear corpus to pass | 70 | Not Started | — |
| 72 | Approval UI + diff preview + capability summary | Medium | OpenCode | Component work on an established contract | 61, 70 | Not Started | — |
| 73 | Transcript block lifecycle + resize policy + scrollback | High | Codex | Classic source of duplication/loss bugs; needs rigorous state handling | 70 | Not Started | — |
| 74 | Slash commands, resume picker, `/context`, transcript search, mode cycling | Low | OpenCode | Many small similar components | 65, 70 | Not Started | — |
| 75 | Debug protocol (layout dump, synthetic input) + a11y modes | Medium | OpenCode | Additive and well-specified | 70 | Not Started | — |
| 76 | App-server: JSON-RPC methods, token-auth WS, patch streaming, approval relay | Medium | Codex | Protocol conformance plus the CVE-class auth regression test | 45, 61 | Not Started | — |
| 77 | ACP agent mode | Medium | Codex | Spec-driven mapping onto the existing runtime API | 76 | Not Started | — |
| 78 | MCP client: stdio/HTTP/OAuth, deferred definitions, tool search | Medium | Codex | SDK integration with a documented spec and interop tests | 46, 57 | Not Started | — |
| 79 | MCP server mode | Low | OpenCode | Thin surface over the existing runtime API | 76, 78 | Not Started | — |
| 80 | `dyn` catalog: JSON-Schema→CLI synthesis, `--q`/`--help`/stdin, image re-attach | High | Claude Code | Novel design with no reference implementation; ergonomics decide whether ADR-009 works | 52, 78 | Not Started | — |
| 81 | Roster policy + 3/8/23 arms from config | Low | OpenCode | Configuration plumbing once `dyn` exists | 47, 80 | Not Started | — |
| 82 | ⛔ Harbor adapter + EXP-04 runner | Medium | Codex | Python + container orchestration against a documented interface | 11, 81 | Blocked | B4: Model families + budget pending |
| 83 | Plugin loader: Agent Plugins v1, signature/allowlist/pinning, `.claude-plugin` compat | Medium | Codex | Spec-conformant loading with clear failure modes | 62 | Not Started | — |
| 84 | ⛔ Plugin worker host + capability-scoped API (out-of-process, kill boundary) | High | Claude Code | The extension trust boundary; ADR-002's second half | 29, 83 | Blocked | B3: JS plugins scope decision pending |
| **Wave 9 — Hardening & quality** |
| 85 | Telemetry: OTel setup, pinned GenAI attributes, cost model, metric set | Medium | Codex | Well-documented instrumentation with a fixed attribute list | 36 | Not Started | — |
| 86 | Secret redaction + CI artifact scanner | Medium | Codex | Detection rules plus a CI gate; concrete pass/fail | 85 | Not Started | — |
| 87 | `replay` + `rerun` + local trace viewer | Medium | Codex | Deterministic reconstruction against an existing journal contract | 31, 85 | Not Started | — |
| 88 | Perf bench suite (startup, stream, stub RPC, search) + thresholds | Low | OpenCode | Harness plumbing; numbers come from the code, not judgment | 19, 70 | Not Started | — |
| 89 | Soak + resilience suites (200k context, 100 MB output, fault matrix) | Medium | OpenCode | Long-running scripted scenarios, low design content | 34, 68 | Not Started | — |
| 90 | Migration harness + recorded session corpora | Medium | Codex | Version-matrix testing with exact equality requirements | 30, 32 | Not Started | — |
| 91 | ⛔ Release pipeline: build, sign, notarize, SBOM, source-map gate | Medium | Codex | Multi-platform signing flow with hard gates | 9 | Blocked | B7: Apple/Windows signing certificates pending |
| 92 | Install channels (npm/brew/winget/script/container) + install smoke | Low | OpenCode | Packaging manifests, repetitive across channels | 91 | Not Started | — |
| 93 | Nightly workflow + flake tracker + path-filtered security jobs | Low | OpenCode | CI YAML on an established base | 9, 26 | Not Started | — |
| **Wave 10 — Research & documentation** |
| 94 | ⛔ Analysis scripts: mixed-effects models, CIs, Holm correction, figures | High | Claude Code | Statistical modelling where a silent error corrupts every conclusion | 56, 82 | Blocked | B4: Model families + budget pending |
| 95 | EXP-05 full run orchestration + results ingest | Low | OpenCode | Batch execution against a finished runner | 55, 94 | Not Started | — |
| 96 | EXP-08 Terminal-Bench run orchestration | Low | OpenCode | Same pattern, different dataset | 82, 94 | Not Started | — |
| 97 | Experiment reports + limitations + conclusions | High | Claude Code | Drawing conclusions from evidence, including negative results — the study's actual output | 94, 95, 96 | Not Started | — |
| 98 | ADR outcome annotation + reversal-trigger update | Low | OpenCode | Mechanical edit across 20 ADRs once 97 exists | 97 | Not Started | — |
| 99 | Threat-model review document + sign-off checklist | High | Claude Code | Adversarial synthesis across the whole system | 26, 86 | Not Started | — |
| 100 | Operator docs + runbooks + troubleshooting + profiling | Low | OpenCode | Documentation from existing behaviour | 24, 91 | Not Started | — |
| 101 | User + admin docs; plugin SDK docs + reference plugin | Low | OpenCode | Volume documentation with a working system to describe | 74, 84 | Not Started | — |
| 102 | Reproduction guide + drill script | Medium | Codex | Must actually execute end-to-end on a clean machine | 11, 97 | Not Started | — |

---

## Blockers — I need your answers before these sessions start

| # | Task | What I need | Why I won't guess |
|---|---|---|---|
| B1 | 1 | Telemetry default (local-only vs opt-in export), product licence (Apache-2.0 vs proprietary), journal encryption at rest (off by default vs opt-in) | These three change the config schema, the LICENSE file and privacy defaults that ~30 later tasks reference |
| B2 | 50 | Is hashline anchoring in v1, or deferred to a post-1.0 experiment? | It's an unproven format; including it adds an engine plus a corpus arm |
| B3 | 84 | Are in-process JS plugins permitted at all in v1 (signed first-party only), or strictly out-of-process? | Decides the worker-host API surface and the T5 threat mitigation |
| B4 | 82, 94–97 | Which three model families for the experiments, and the total inference budget | Sets sample sizes, run counts and whether EXP-08 gets 3 repeats or 1 |
| B5 | 95, 96 | Experiment artifact storage: git-lfs or S3-with-hashes-in-git? | Changes the results-ingest code and the reproduction procedure |
| B6 | 4, 22 | Do you have a domain-joined/managed Windows VM for the GPO spike? | Without it, Windows sandbox limitations stay unverified and task 22 ships blind |
| B7 | 91 | Who owns procurement of the Apple Developer ID and Windows signing certificate, and has it started? | External lead time; it's the classic late blocker (R-10) |
| B8 | 16, and Rust tasks generally | Does your OpenCode setup handle Rust competently? | I assigned task 16 (Rust crate wiring) to OpenCode; if Rust is weak there, it moves to Codex and the budget rises by ~1 |

---

## Handoff briefs

Paste directly into the assigned agent. Each assumes the agent can read the repo and the two planning documents.

**1 (Claude Code).** Read blueprint §6 (GAP-05/06/10), §18 and §23, then write three ADRs in `docs/adr/`: telemetry default, product licence, journal encryption at rest. Use the decisions I give you at the start of the session — do not pick them yourself — and for each ADR record context, options, rationale, trade-offs and a reversal trigger in the existing ADR format.

**2 (Claude Code).** Read blueprint §28 and §29. Write `docs/research/methodology.md`, a pre-registration template, and pre-registrations for EXP-01…EXP-04, each stating variables, arms, N (mark "pending pilot" where §28.6 says so), primary metric, success threshold, analysis method and exclusion rules. These must be falsifiable and dated before any run.

**3 (OpenCode).** Using the template from task 2 and the table in blueprint §28.3, write pre-registration files for EXP-05, EXP-06, EXP-07 and EXP-08. Copy the structure exactly; every field in the template must be filled from the blueprint, and mark anything the blueprint leaves open as "pending".

**4 (Codex).** Write a Rust probe that attempts, on a Windows host, each capability the sandbox-runtime Windows backend needs (dedicated user creation, WFP filter, NTFS ACE application, elevated install) and reports which are blocked by group policy. Run it on the VM I provide, then write `docs/threat-model/windows-gpo.md` listing every degradation with its remediation.

**5 (OpenCode).** Scaffold the monorepo per blueprint §15: pnpm workspace, turbo pipelines, Cargo workspace, uv project, `tsconfig.base.json` (strict, ESM, NodeNext), `biome.json`, `.tool-versions`. Success is `pnpm install && cargo build && uv sync` succeeding on macOS, Linux and Windows with empty packages.

**6 (Claude Code).** Build `packages/protocol` with Zod schemas for the patch envelope, session tree node types, `CapabilityRequest`, and the experiment manifest, exactly as specified in blueprint §9.2, §17.1 and §29. Include `schemaVersion` per node type and export JSON Schema. Field semantics matter more than speed here — flag anything in the spec that is ambiguous rather than resolving it silently.

**7 (Codex).** Define the stub RPC request/response schemas (blueprint §19.3) in `packages/protocol`, then generate matching Rust types into `native/loom-stub-protocol`. Add a round-trip test that serializes every message type in TypeScript, deserializes in Rust, and back, failing on any field mismatch.

**8 (Codex).** Configure Biome and `dependency-cruiser` per blueprint §15 and NFR-018, including a rule that forbids importing `child_process` or performing filesystem writes anywhere outside `packages/stub-client` and `native/`. Add a test that plants a violating file and asserts the lint run fails.

**9 (OpenCode).** Write `.github/workflows/pr.yml` per blueprint §38: three-OS matrix, dependency caching, `pnpm install --frozen-lockfile`, biome, `tsc --noEmit`, dependency-cruiser, cargo fmt/clippy, unit tests, build. Target under 12 minutes p95; report the measured time.

**10 (Claude Code).** Implement the JSONL journal in `packages/storage`: append with `seq` monotonicity, fsync at turn and tool boundaries only, the snapshot format from blueprint §9.2, and corrupt-tail truncation that records a repair event. Add a property test for append/read/materialize. Decide and document where commit points sit — that choice drives NFR-005.

**11 (OpenCode).** Implement the experiment manifest validator and append-only index writer in `packages/experiments` from the schema in blueprint §29. A manifest missing any required field must be rejected before a run starts; add tests covering each missing-field case.

**12 (Codex).** Create `native/loom-stub`: tokio process, JSON-RPC framing over stdio matching `loom-stub-protocol`, and the `health` method returning version, sandbox profile in force and enforcement status. Add a contract test that the TS side can complete the handshake and rejects a version mismatch.

**13 (Codex).** Implement the stub `exec` op: spawn by program and argv (no shell), stream stdout/stderr with byte and wall-clock budgets from the request, and kill the process tree on budget exhaustion, returning `{status, bytes, truncated, elapsedMs}`. Kill must complete within 1 second; test it under a process that ignores SIGTERM.

**14 (Codex).** Implement stub filesystem ops (`read`, `write`, `stat`) using handle-based access: canonicalize the path, verify containment in the workspace root, open by handle, re-verify after open, then act. Writes are atomic (temp + rename) and preserve line endings, BOM and file mode; binaries are refused.

**15 (Codex).** Write `proptest` suites against task 14 covering symlink escapes, Windows junctions and reparse points, case-insensitive collisions, unicode normalization and TOCTOU races (replace the path between canonicalize and open). The suite must find no input that reads or writes outside the workspace root.

**16 (OpenCode).** Implement stub `glob` and `grep` using the `grep-searcher`, `ignore` and `globset` crates, respecting `.gitignore` and the byte budget. Add parity tests comparing results against the `rg` CLI on the fixture repos for a set of patterns.

**17 (Codex).** Implement the stub job primitive with `portable-pty`: `job/spawn`, `job/signal`, `job/attach`, `job/list`, covering background shells, daemons and PTY sessions, with stdout/stderr spilling to blobs. Cover exit, signal and orphan cases in tests.

**18 (Codex).** Add stub `batch` (ordered list of ops in one round trip, stopping at the first failure with per-op results) and `script` (bounded script evaluation stub-side with rate-limited host callbacks). Measure and report the round-trip reduction on a representative multi-edit sequence.

**19 (Codex).** Build `packages/stub-client`: typed client for every stub op, budget enforcement on the host side, stream framing, and a single reconnect attempt before failing the turn. This is the only module allowed to spawn processes — keep that surface minimal and documented.

**20 (Claude Code).** Implement the local placement driver wrapping the stub with `@anthropic-ai/sandbox-runtime` on macOS and Linux: generate the profile from the session's sandbox config, and refuse to start when the profile cannot be enforced rather than degrading. Document the exact profile scope decisions you make in `docs/architecture/sandbox.md`.

**21 (Claude Code).** Implement the config-path deny list (git hooks, git config, mcp.json, agent config dirs, shell startup files) so it holds regardless of user rules, plus the host-side egress proxy with a hostname allowlist and an escalation hook for unknown domains. These are the T2 and T3 mitigations; make the failure mode "blocked and reported", never silent.

**22 (Codex).** Implement the Windows alpha placement using sandbox-runtime's `srt-win` path behind an opt-in flag, surfacing each limitation from the task-4 report in the UI when the flag is on. Escape-test failures on Windows are recorded, not fatal, at this stage.

**23 (OpenCode).** Add a container placement driver that runs the same stub in a Docker container, recording the image digest in the session. The stub RPC contract must not change — only the spawn path differs.

**24 (Codex).** Implement `loom doctor`: probe sandbox enforceability per platform, check the stub binary version, verify egress proxy reachability and config file validity, and print remediation for each failure. Wire the same probes into startup so an unenforceable profile refuses to start.

**25 (Claude Code).** Build the escape-test harness plus three exemplar classes: write outside the workspace root, egress to a non-allowlisted host, and write to a denied config path. Design the harness so classes are data-driven and the report format is machine-readable — tasks 26 and 64 will extend it.

**26 (OpenCode).** Extend the escape suite from task 25 with the remaining five classes (symlink escape, TOCTOU, raw socket, nested container, Windows subset) and wire it into CI across three OSes. Follow the existing class structure exactly; the report must list Windows exceptions separately.

**27 (Codex).** Implement the EXP-01 and EXP-02 runners: EXP-01 runs the escape suite under both `boundary.mode` arms and counts blocked classes; EXP-02 measures added per-tool-call latency and its share of turn wall-clock. Both write valid manifests via `packages/experiments`.

**28 (Claude Code).** Implement the session tree and patch operations in `packages/session` per blueprint §9.2–§9.3: `create`/`set`/`append`/`delete`/`snapshot`, apply and diff. Entity granularity is a design decision — choose it so that adding a stateful feature later never requires new rewind or fork code, and write down the rule you used.

**29 (Claude Code).** Add `session.state.declare()` as the only state channel available to kernel features, Directors and plugins, allocating a journaled tree node. Then add a lint rule making module-level mutable state in those packages a build error. This is ADR-004's enforcement — if there is a way around it, H3 fails.

**30 (Codex).** Implement tree snapshots with zstd compression at turn boundaries and a fast resume path that loads the last snapshot then replays subsequent patches. Target resume under 2 seconds p95 for a large session; report the measured number.

**31 (Claude Code).** Implement rewind, fork and resume as tree diff-and-apply over the journal. Decide and document what a fork inherits, what resume re-verifies against the workspace, and how drift is surfaced — these semantics are what tasks 35 and EXP-03 will test to destruction.

**32 (OpenCode).** Implement the SQLite projections from blueprint §17.4 (`kysely` migrations, all tables, FTS5) as folds over the journal, plus a `loom projections rebuild` command. The rebuild must produce byte-identical tables to the incremental path; test that.

**33 (OpenCode).** Implement the content-addressed blob store with refcounting and a GC that removes only unreferenced blobs, plus the spill helper used by bounded tool results. Include tests for concurrent writes of the same content.

**34 (Codex).** Build a crash-injection harness that kills the process at 1,000 distinct points across a scripted session and asserts, on restart, that no committed patch is lost and the tree materializes. Report any point where recovery required manual repair.

**35 (Codex).** Write a set of adversarial test plugins that deliberately try to hold state outside the journal (closures, module globals, timers, external files), then implement the EXP-03 runner comparing divergence counts under both `state.discipline` arms across 1,000 randomized rewind/fork/resume sequences.

**36 (Claude Code).** Implement the kernel turn FSM per blueprint §8.4: states, transitions, interrupt and error paths, with every transition journaled. Everything later attaches here, so keep the state set minimal and make illegal transitions unrepresentable rather than merely tested.

**37 (Claude Code).** Implement the Director stack: journaled subtree, `prepare_inference` outside-in, `on_yield` inside-out, decisions Pass/Continue/Yield/Push/Done/Fail, plus TodoReminder, Plan, Goal and ForceTool built-ins. There is no reference implementation for this — pay particular attention to composition when three Directors are active and to what rewind should do to the stack.

**38 (Codex).** Implement budgets (turns, wall-clock, cost, bytes, subagent depth and fan-out), cancellation that actually kills in-flight stub work, and the steering queue for mid-turn user input. Esc must terminate a running tool within 1 second p95.

**39 (Claude Code).** Design and implement the `compat` knowledge base: a declarative rule format across taxonomy, classes and providers, and a compiler where an unknown directive or two equally specific conflicting rules is a build error, and no matching rule yields `unknown` rather than `false`. Seed it with rules for the models we target and document the precedence algorithm.

**40 (Codex).** Implement the `ModelProvider` port and the Anthropic and OpenAI adapters over AI SDK 7: streaming text, tool-argument and reasoning deltas, usage and cache counters, and typed errors with retry only on 429/5xx. Add contract tests replaying recorded fixtures.

**41 (OpenCode).** Add Google and OpenAI-compatible adapters implementing the same port as task 40, reusing its contract tests. Where a capability is absent, report it through the compat layer as `unknown` rather than assuming false.

**42 (Codex).** Wire the provider-native escape hatches: Anthropic server-side compaction, context editing and memory tool; OpenAI Responses `apply_patch`. Selection must be capability-gated through `compat`, never a provider name check in calling code.

**43 (Codex).** Implement argument repair and corrective inference: JSON repair for malformed tool arguments, parsing of leaked tool-call and thinking dialects into canonical blocks, and repetition-loop detection. Be strict about the semantic contract and charitable about dialect; ambiguous input becomes a structured retryable error.

**44 (OpenCode).** Build a mock provider that replays recorded streams deterministically (including tool-call dialect variants and error injection) plus a recorder that captures real provider traffic into fixtures with credentials stripped. All of CI depends on this being deterministic.

**45 (Codex).** Implement `loom run -p` per FR-002: `stream-json` and `json` output, `--max-turns`/`--max-cost`/`--output-schema`, exit codes 0/2/3/4/1, and a resumable needs-approval payload when a policy decision requires a human. This is the first end-to-end slice — make a golden task pass against the mock provider and one real provider.

**46 (Claude Code).** Define the `Tool` interface (`descriptor`, `plan` returning a `CapabilityRequest`, `execute` streaming through the stub), build the registry, and implement `read` as the reference tool with ranges, structural summaries and internal URI schemes. Every later tool copies this shape, so the ergonomics of `plan()` matter as much as its correctness.

**47 (OpenCode).** Implement `write`, the `glob`/`grep` tool wrappers, `task`, `ask` and the todo tool following the exact pattern from task 46. Each needs a schema, a `plan()` producing an accurate capability, and tests; do not invent new patterns.

**48 (Codex).** Implement the `str_replace` engine in `native/loom-patch`: exact match with a uniqueness check, whitespace-tolerant fallback only when unique, and on failure return the nearest candidates with line numbers without modifying the file. Silent fuzzy application is a defect, not a fallback.

**49 (Codex).** Implement the V4A `apply_patch` parser and applier against OpenAI's published format, returning per-operation completed/failed results. Fuzz the parser; malformed patches must fail cleanly rather than partially applying.

**50 (Codex).** Add the whole-file rewrite engine and, if I confirm it is in scope, the hashline engine (short per-line content hashes returned by `read`, referenced by edits). Both sit behind `edit.format` flags and share the corpus harness.

**51 (Codex).** Implement checkpoints: content-addressed pre-write snapshots, a `restorable` flag set false when symlinks or hardlinks are skipped, and a restore path that refuses non-restorable checkpoints with an explanation rather than partially rolling back.

**52 (Codex).** Implement the shell tool: `bash` on POSIX, `pwsh` preferred over PowerShell 5.1 on Windows with UTF-8 console encoding forced, foreground and background job modes through the stub. Test non-ASCII output on Windows explicitly — that is a documented failure mode in comparable products.

**53 (OpenCode).** Implement repository discovery: git root, worktrees, submodules, monorepo packages, ignore rules, and instruction files (`AGENTS.md` then `CLAUDE.md`, nested loaded lazily) journaled by content hash. Validate against the five fixture repo shapes.

**54 (OpenCode).** Implement an LSP client that requests diagnostics for a file after an edit, bounded in time and output, appending them to the tool result. A missing or slow server must degrade silently, never block the edit.

**55 (OpenCode).** Build the edit corpus: 300 real edits across 8 languages with before/after fixtures, plus a harness that measures apply rate and repair rate per engine. Include awkward cases deliberately — CRLF files, BOM, deep indentation, near-duplicate anchors.

**56 (Claude Code).** Using the corpus from task 55, run a pilot across the arms and compute the observed variance, then derive the sample sizes needed for EXP-04, EXP-05 and EXP-06 at the effect sizes we pre-registered. Write the result into the pre-registrations; this closes GAP-08 and determines whether the study is powered.

**57 (Claude Code).** Implement the policy engine: evaluate `CapabilityRequest` against modes and rules with `deny > ask > allow` and tier precedence managed > user > project > local > session, plus a compiler turning `Tool(pattern)` rules into capability predicates. Evaluation errors must fail closed, and managed rules must be provably un-loosenable from lower tiers.

**58 (Codex).** Implement the settings tiers and managed immutability across config files, wiring precedence into the policy engine and `loom config print --effective --with-sources`. Test every precedence combination, including a managed rule that a project file tries to relax.

**59 (Claude Code).** Implement shell command decomposition into per-subcommand capabilities (`&&`, `||`, `;`, `|`, `$()`, backticks, leading assignments) with the invariant that any unparsed expansion escalates to `ask`. Write the property test that tries to break it — this is the invariant most likely to fail subtly, and the sandbox is the backstop, not the parser.

**60 (OpenCode).** Wire the permission mode matrix from blueprint §10.3 as data, plus an exhaustive unit matrix covering every mode × capability class × tier combination. The table is fully specified; do not reinterpret it.

**61 (Codex).** Implement approval routing to the active surface, hooks and (stubbed) reviewer agent, with once/session/persist scopes and a rule preview that matches byte-for-byte the rule that "allow always" writes. Timeouts deny and journal `decided_by=timeout`.

**62 (Codex).** Implement the hook bus with the event set from blueprint §12 and command/http/in-process handlers returning allow/deny/ask/defer plus `updatedInput` and `additionalContext`. Cap handler output with spill, and kill handlers that exceed their timeout.

**63 (OpenCode).** Add the workspace-trust gate blocking project-level hooks until the repository is trusted, plus managed-hook immunity from local disabling. Small addition to task 62 — follow its existing structure.

**64 (OpenCode).** Extend the escape harness with 40 prompt-injection scenarios (repository files, tool output and MCP results instructing destructive or exfiltrating actions) and an EXP-07 runner comparing `capability` and `pattern_only` policy arms by attempts blocked before execution.

**65 (Codex).** Implement per-component context accounting (system prompt, instructions, skills, tool definitions, memory, conversation, tool results by age, reserved output) accurate to within 2%, exposed as data for `/context` and as an OTel metric.

**66 (Codex).** Implement central output bounding in the runtime — not in individual tools — with blob spill, a structured `diag` notice and a `notrunc` opt-out. The hard invariant is that no single tool result can exceed its byte budget in context; fuzz it with a 100 MB output.

**67 (Codex).** Implement oldest-first tool-result eviction to placeholders and the `fold` model that lets UI history and model history differ. Folds must remain valid after compaction.

**68 (Claude Code).** Implement the three compaction strategies behind `compaction.strategy`: blocking, speculative (start ~10% before the limit on a parallel branch and splice back), and provider-native where capability-gated, plus the thrash guard that stops after K attempts. The journal is never rewritten — compaction appends a record with a structured summary, and the spliced request must be a provable fold of the journal.

**69 (OpenCode).** Implement the EXP-06 runner measuring post-threshold stall, task success and tokens/USD across the three compaction arms on the long-task set, writing valid manifests.

**70 (Claude Code).** Build the Ink application shell: subscribe to the session snapshot and patch stream, render exclusively from it, and define the component contract that plugins and tools must use (semantic elements, no ANSI strings). Establish the invariant that no component reads state from anywhere else — the render-cost trap in comparable products started with a looser contract than this.

**71 (Codex).** Implement the sanitization layer that decomposes and strips ANSI and control sequences from all external text (tool output, web content, MCP results) before it reaches any component, plus the semantic component set the contract requires. Test against an ANSI-injection corpus including cursor moves and screen clears.

**72 (OpenCode).** Build the approval UI: capability summary, diff preview, the exact rule that "allow always" would write, and the once/session/persist options. Follow the component contract from task 70; the rule preview must match what task 61 writes.

**73 (Codex).** Implement the transcript block lifecycle (mutable → finalized → committed, append-only heads may commit early), native scrollback handoff and the resize policy. Duplication or loss on resize is the failure mode to test hardest.

**74 (OpenCode).** Implement slash commands, the `/resume` session picker, the `/context` view, transcript search and mode cycling as components on the existing contract. Many small similar pieces — keep them consistent.

**75 (OpenCode).** Implement the headless debug protocol (deterministic layout dump plus synthetic input injection) and the accessibility modes: screen-reader announcements for state changes, reduced motion, and an icon set with no colour-only meaning.

**76 (Codex).** Implement the app-server: JSON-RPC methods from blueprint §19.2 over stdio by default and WebSocket with a per-session bearer token, patch streaming and server-initiated approval requests. Add the regression test asserting an unauthenticated local WebSocket request cannot reach any handler.

**77 (Codex).** Implement ACP agent mode with `@agentclientprotocol/sdk`, mapping ACP methods onto the runtime API and declining unsupported capabilities explicitly. Verify with a scripted client that completes an edit task and answers a permission request.

**78 (Codex).** Implement the MCP client on `@modelcontextprotocol/client@2`: stdio and Streamable HTTP with OAuth, deferred tool definitions surfaced through tool search, and circuit-breaking for flapping servers. Interop-test against both the 2026-07-28 and 2025-11-25 reference servers.

**79 (OpenCode).** Expose the harness as an MCP server (`run`, `resume`, `status`) over stdio and HTTP, refusing privileged modes when driven as a server. Thin surface over the existing runtime API.

**80 (Claude Code).** Design and implement the `dyn` catalog: synthesize a stable CLI from JSON Schema for MCP tools and the long tail, with `--q` discovery, `--help`, stdin and file arguments, and image results re-attached. Ergonomics decide whether the small-roster decision works in practice — optimize for what a model can discover from `--help` alone.

**81 (OpenCode).** Implement the roster policy so the permanent tool set is configuration-driven with 3, 8 and 23-tool arms, everything else reachable through `dyn`. The arms must differ only by roster composition — verify by diffing the assembled prompt.

**82 (Codex).** Implement the Harbor adapter that installs Loom into a task container and runs it, plus the EXP-04 runner sweeping roster arms across models and tasks with valid manifests. Confirm the arms differ by exactly one variable before running anything expensive.

**83 (Codex).** Implement the Agent Plugins 1.0.0 loader (`plugin.json`, `skills/`, `mcp.json`, reverse-domain extras) with signature verification, version pinning and allowlist checks, plus a compatibility loader for `.claude-plugin/plugin.json`. Installation from a directory, git and zip must all work.

**84 (Claude Code).** Implement the plugin worker host: plugins run out of process behind a capability-scoped API with a real kill boundary, and their state exists only through `session.state.declare()`. This is the second half of the trust boundary — a plugin must not be able to reach the filesystem, network or journal except through the API you define.

**85 (Codex).** Implement OpenTelemetry setup with the span tree `invoke_agent` → `chat`/`execute_tool` → `stub.rpc`, the metric set from blueprint §24, the cost model, and pinned GenAI attribute names centralized in one module with a dual-emission flag. Content capture stays off by default.

**86 (Codex).** Implement secret redaction (regex plus entropy) applied before results enter context, journal or spans, plus a CI scanner that fails if key material appears in any e2e artifact. Include the subprocess environment scrubbing.

**87 (Codex).** Implement `loom replay` (deterministic reconstruction from the journal) and `loom rerun` (re-executes against providers, explicitly non-deterministic) as separate commands with different output schemas, plus a local trace viewer. Replay must reproduce the tool sequence byte-identically.

**88 (OpenCode).** Build the benchmark suite for startup, stream overhead, stub RPC latency and search, with the thresholds from blueprint §10 enforced in nightly CI and results trended. Report measured numbers against each target.

**89 (OpenCode).** Build the soak and resilience suites: a 200k-token session with 500 tool calls, a 100 MB tool output, 50 concurrent jobs, and the fault matrix (stub kill, disk full, provider 5xx storm). Assert memory and budget invariants hold throughout.

**90 (Codex).** Build the migration harness with recorded session corpora from every schema version, asserting sessions written by version N open in N+1 and projections rebuild identically. Wire it into CI on changes to `protocol` or `storage`.

**91 (Codex).** Implement the release pipeline: build npm and platform artifacts plus the stub binaries, run the source-map gate, sign and notarize, produce the SBOM and checksums, and publish to a staging channel. The gate must fail on a planted source map — test that.

**92 (OpenCode).** Add the install channels (npm, Homebrew tap, WinGet manifest, install script, container image) and an install smoke test that runs a trivial session on each of the three OSes after installation.

**93 (OpenCode).** Write the nightly workflow (full integration, e2e, escape suite on three OSes, perf, soak, migration, benchmark smoke), the flake tracker, and the path-filtered security jobs. Base it on the existing PR workflow.

**94 (Claude Code).** Write the analysis scripts: mixed-effects models for the crossed task × model designs, Wilson intervals for proportions, Holm–Bonferroni across primary hypotheses, and the figures for each experiment. A silent error here corrupts every conclusion, so state assumptions in comments and include a synthetic-data test with a known answer.

**95 (OpenCode).** Orchestrate the full EXP-05 run across models and arms using the existing runner, ingest results into the index, and produce the per-model apply-rate and repair-rate matrix. Record excluded runs with reasons rather than dropping them.

**96 (OpenCode).** Orchestrate the EXP-08 Terminal-Bench 2.0 run at the pinned dataset commit, ingest results, and produce the success rate with confidence intervals plus a per-task failure list.

**97 (Claude Code).** Write the per-experiment reports and the limitations section from the actual results, stating for each hypothesis whether it was confirmed, refuted or inconclusive, citing run ids. Report negative and inconclusive results as prominently as positive ones — the study's value depends on that.

**98 (OpenCode).** Annotate all 20 ADRs with the experimental outcome and update each reversal trigger to reflect what we now know. Mechanical edit driven by task 97's reports.

**99 (Claude Code).** Write the threat-model review document: walk T1–T12 against the implemented system, note where the escape suite provides evidence and where it does not, and list residual risk with owners. This is a synthesis task across the whole codebase, ending in a sign-off checklist.

**100 (OpenCode).** Write the operator documentation set: deployment, rollback, troubleshooting, profiling and runbooks, from the implemented behaviour. Success is a new engineer deploying and debugging from the docs alone.

**101 (OpenCode).** Write the user and administrator documentation plus the plugin SDK docs and a working reference plugin. The reference plugin must install through all three sources and exercise skills, an MCP server and a hook.

**102 (Codex).** Write the reproduction guide and a drill script that clones at a commit SHA, restores locked dependencies, verifies the container digest and dataset hash, runs an experiment arm and compares metrics against the manifest within tolerance. It must actually run end-to-end on a clean machine.
