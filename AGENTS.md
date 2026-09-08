# Repository Guidelines

## Project Structure and Current Scope

This repository currently contains om-code's planning source of truth:

- `docs/om-code-master-delivery-blueprint.md` — current learning-release requirements and milestones.
- `docs/coding-agent-harness-final-architecture.md` — current architecture and extension contracts.
- `docs/om-code-agent-execution-backlog.md` — dependency-ordered `LRN-*` implementation tasks, each with its acceptance criteria, the universal Definition of Done, and the cross-task dependency map. Read a task's criteria before starting it.
- `docs/adr/ADR-023-macos-openai-compatible-learning-scope.md` — current scope decision.

Initial support is macOS on the developer's MacBook, with arm64 as the first verified target. Initial inference uses configurable OpenAI-compatible Chat Completions. Keep other API formats and platforms possible through ports, but do not implement their adapters until scope expands.

TypeScript product modules belong in `packages/`, the small Rust execution boundary in `native/`, fixtures and cross-package/escape suites in `tests/`, and architecture/research material in `docs/`. Python tooling and `evals/`/`experiments/` implementation are deferred. The old production plans under `docs/architecture/archive/` and deferred research documents are historical references, not active gates. Update linked active plans together when a decision affects scope or sequencing.

After every change, assess whether it introduces durable context that other agents need to work correctly, such as a new command, convention, architectural boundary, dependency, or scope decision. If it does, update `AGENTS.md` in the same change; do not add routine implementation details or use this file as a change log.

## Build, Test, and Development Commands

The pnpm workspace holds `cli`, `storage`, `protocol`, `session` (pure materialization), `providers` (Chat Completions), `kernel` (system prompt assembly and the turn loop), `stub-client` (the stub port plus the local-ts driver behind it), `tools` (the `Tool` interface, registry, seven-name roster, and `read`/`grep`/`glob` implementations), `context` (central bounding: result truncation with blob spill, run budgets, cost arithmetic), `policy` (decision core: capability requests to allow/ask/deny, protocol-only; tier files `~/.om-code/policy.json` > `<root>/.om-code/policy.json` > session, deny-anywhere-wins; modes contribute implicit deny rules merged into the user tier), and a private root `tests/` workspace for shared contracts and integration. Do not claim a gate passed without running it.

- `pnpm install --frozen-lockfile` — reproduce pinned TypeScript dependencies.
- `pnpm run check` — the full local gate: lint, typecheck, build, test, in that order.
- `pnpm run lint` (`biome check .` plus `pnpm run lint:deps`), and `pnpm -r --if-present run typecheck`, `test`, `build` — the individual gates; required packages must define these scripts.
- `pnpm run lint:deps` — dependency-cruiser layering graph (AC-14.4): protocol leaf, session→protocol, kernel→protocol/session, adapters never cross or touch cli, nothing touches cli, no cycles. Workspace imports resolve to `src` via `tsconfig.depcruise.json` (never extend it from a package), so it needs no build first; `dist/` is excluded.
- `pnpm run test:coverage` — the suite once per package with the text coverage reporter printed, never gated (AC-15.4). `.github/workflows/ci.yml` is the single macOS arm64 gate: frozen install, `biome check`, `lint:deps`, typecheck (which builds first), then the suite with coverage; it installs ripgrep via Homebrew and fails if the suite exceeds 3 minutes (AC-15.3).
- `pnpm --filter @om-code/tests test` — shared provider contracts, boundary checks, and journal integration; build first when running individual suites.
- `node tests/manual/transport-close.mjs` — explicit loopback socket-close verification, outside the default socket-free suite.
- `node tests/manual/journal-demo.mjs` — explicit native-lock/SIGKILL/repair and file-permission demonstration using temporary state.
- `node --env-file=.env tests/manual/provider-smoke.mjs` — explicit paid text/tool smoke, capped at 512 completion tokens per request; never part of `pnpm test`.
- `node --env-file=.env tests/manual/record-fixture.mjs <name>` — explicit paid capture that writes credential-stripped fixtures via `recordingFetch`; never part of `pnpm test`.
- `om run` — interactive multi-turn REPL; `om run -p "<prompt>"` is one-shot, `--json` emits schema-valid journal records as NDJSON, and `--max-turns` counts agent iterations (model inferences within one user request, LRN-19), not REPL lines.
- `om run` resolves the git root from any subdirectory (outside a repo it runs in explicit single-directory mode, `project_root == cwd`) and loads `AGENTS.md` then `CLAUDE.md` from the root into every turn, journaled by content hash (LRN-20).
- `om sessions` and `om show <id>` — list project-scoped journal sessions and render one without inference.
- `pretypecheck` builds the workspace first, so a package typechecks against the built declarations of the workspace packages it imports (rather than their sources).
- `pnpm add --global ./packages/cli` — put `om` on your PATH. `pnpm link --global` was removed in pnpm 11, and `~/Library/pnpm/bin` must be on PATH first (`pnpm setup`).

There is no `pnpm dev`: `om run` is the product REPL, not a development server.

`rg` (ripgrep 15.2.0 here) must be on PATH: the local-ts driver's `glob`/`grep` delegate to `rg --files` / `rg --json` rather than reimplementing search (ADR-025). A missing binary is a named `brew install ripgrep` failure, and `om doctor` will check for it (AC-35.1).

`fs-native-extensions@1.5.0` is the sole early native runtime dependency, confined to storage for nonblocking macOS BSD advisory locks. Its packaged native addon loads without adding a Cargo workspace. Keep its lock inode permanent; never unlink it or replace it during journal repair.

`packages/providers` depends on `@om-code/protocol` only: no LangChain, LangGraph, or other agent/LLM framework at the transport, prompt-assembly, or turn-loop layers. See [ADR-024](docs/adr/ADR-024-no-langchain.md) before adding one back.

`packages/providers` also exports `FakeProvider` (a scripted `ModelProvider` double that replays turns through the same `ResponseProjection` the real adapter uses) and `recordingFetch` (a pure tee-and-redact `fetch` wrapper for capturing fixtures; it performs no file I/O itself). Scenario-to-script mappings for the shared contract suite live in the root `tests/contract/` workspace, not in `packages/providers`, mirroring how `adapter-fixtures.ts` already maps scenarios to the real adapter — keeps the dependency direction one-way (`tests` depends on `providers`, never the reverse).

Rust is not in this repository yet — the Cargo workspace and `native/om-stub` arrive in M4 (LRN-30), and until then these are the commands that will apply, not commands you can run:

- `cargo build --locked` and `cargo test --locked` — build and test Rust crates.
- `cargo fmt --check` and `cargo clippy --locked -- -D warnings` — enforce Rust style and linting.

Run actual sandbox tests on the supported macOS target. Default tests use fake providers and must not spend inference credits. Turbo, Python/uv, other-platform runners, public packaging, and signing credentials are not initial prerequisites.

## Coding Style and Architectural Boundaries

Use Biome for TypeScript, and rustfmt/Clippy for Rust. Use ATX headings, concise Markdown, and tables when they improve comparison. Name packages by responsibility and branches in kebab-case, such as `feat/session-journal`.

Follow SOLID principles and sound object-oriented design where they improve clarity and changeability: keep modules and types focused on one responsibility, depend on narrow abstractions at architectural boundaries, prefer composition over inheritance, preserve substitutability, and expose small cohesive interfaces. Encapsulate invariants and keep dependencies explicit. Avoid speculative abstractions, unnecessary class hierarchies, and design patterns that add complexity without a demonstrated need; simple functions and data types are often the better design.

Keep provider-specific logic and SDK types out of `packages/kernel`. `packages/protocol` is the wire-schema authority; Rust DTOs are generated or schema-checked mirrors. `packages/protocol` owns the stub RPC wire schemas (`packages/protocol/src/stub.ts`) while `packages/stub-client` owns the port interface, the typed errors and the dialect contract. `packages/sandbox` and `packages/stub-client` depend on protocol contracts, not each other; the CLI composes them.

`packages/kernel` is the only module that builds a system prompt (`role: "system"` message) or assembles a `ModelRequest`; nothing else appends to it (LR-FR-037). Assembly is a pure function of a `SessionView`, resolved config, and a caller-supplied environment/instruction-file snapshot — no clock or filesystem read inside it, so the same input always produces the same request. Instruction-file content enters by reference to its content hash via the `prompt` journal entry kind (protocol's eleventh, added in LRN-09; §7 of the blueprint only fixed ten).

The kernel owns the typed turn state machine and its narrow `JournalSink` port; storage writers satisfy that port structurally, so kernel never imports storage. The loop awaits the authorizing journal append before prompt assembly, inference, and terminal delivery. Protocol has twelve entry kinds: provider and local turn failures use `error` (the twelfth), never `stop_reason` or an invented `StreamFailureKind`; an available provider partial remains an interrupted `assistant_message` v2.

`packages/cli` is the composition root for kernel, providers, storage, session, tools, stub-client, context and policy (LRN-18: it builds the `ToolRegistry`/`ToolRunner` over the local-ts driver and passes model tool schemas plus the runner into the turn; LRN-19: it builds a fresh `RunBudget` per user request and wraps the runner in context's bounder over storage's blob store; LRN-21d: it loads tier rule files and journals every policy decision before the effect it authorizes). `runCli` is async and receives all process-adjacent dependencies through `CliDeps`: streams/output, environment/cwd/host, clock, UUIDv7 factory, settings loader, and provider factory; only `src/om.ts` touches `process`. After every turn the CLI re-reads and materializes the journal before the next prompt. Its journal-sink tee emits the exact appended records in `--json` mode; provisional text/thinking deltas are human-mode only. Storage owns `listSessions` so CLI source performs no direct filesystem I/O.

Field naming: the journal is a wire format, so its fields are snake_case (`turn_id`, `call_id`, `risk_class`) to mirror the Rust DTOs in M4, where snake_case is idiomatic. The stub RPC envelope and frame are camelCase (`maxBytes`, `maxMs`, `elapsedMs`) per blueprint §8.2. TypeScript-internal state (LRN-04's config: `baseUrl`) stays camelCase.

Journal append assigns identity/sequence and fsyncs every record before resolving. Readers verify the entire file before sequence filtering. Only an unterminated final fragment is automatically repairable: preserve the original, then atomically publish the verified prefix plus a repair entry. Terminated corruption and incompatible versions block writes. Journal files live at `<OM_HOME>/sessions/<project-hash>/<UUIDv7>.jsonl`; metadata comes from `session_start`.

Model ports and `ProviderError` live in protocol. Providers and session depend on protocol only; storage does not re-export materialization. `assistant_message` v2 preserves raw tool calls and a typed complete/interrupted outcome; v1 stays readable. Local errors do not occupy `stop_reason`. Callers journal terminal responses and error partials; adapters perform no journal I/O or tool execution.

All workspace reads, searches, writes, and command execution route through `packages/stub-client` to the sandboxed stub. Trusted host application-state reads/writes belong to `packages/storage` and are limited to application-owned configuration, journals, locks, backups and content-addressed blob spills (`<OM_HOME>/blobs/sha256/<ab>/<hash>`). Do not misapply the workspace I/O rule to force journal storage inside the sandbox. Host launch/setup effects are confined to reviewed boundary integration modules; document any sandbox dependency that performs them internally.

Biome's `noRestrictedImports` bans `node:fs`, `fs`, `node:fs/promises`, `fs/promises`, `node:child_process`, `child_process`, `node:module` and `node:os` outside `packages/storage`, `packages/stub-client` and `native/`; tests, configs, scripts and `.mjs` are exempt. `packages/cli/src/types.ts` holds the shared CLI seams (`CliDeps`, `CliIo`, `CliResult`, `ConfigLoader`) so the composition root's import graph stays acyclic — import them from `./types.js`, never from `./cli.js`.

`packages/tools` owns the `Tool`/`ToolDescriptor`/`ToolContext`/`ToolEvent` shapes, the seven-name roster, and the `read`/`grep`/`glob` tools; it depends on `protocol` and `zod` only and is deliberately absent from Biome's `noRestrictedImports` override — that omission enforces AC-16.2. It reaches the stub through its own structural `ToolIo` port that `StubClient` satisfies without importing it, the same relationship kernel's `JournalSink` has with storage; `tests/tool-io-contract.test.ts` is the drift pin. Binary detection happens once in the read tool above the port, leaving drivers as byte pipes.

## Testing Guidelines

Use Vitest for unit, contract, and integration tests; fast-check for focused TypeScript properties; and Rust proptest for path/protocol invariants. Every behavioral fix needs a regression test named for its issue. Security-sensitive changes under `native/`, `packages/policy`, `packages/sandbox`, or `packages/stub-client` also require the relevant macOS escape suite.

Cover stale edits, approval invalidation, incomplete tool streams, unknown usage, cancellation, and crashes between a tool effect and its durable result. Never automatically repeat an arbitrary command with an unknown outcome. Checks establish their tested scope; they do not establish universal sandbox safety or endpoint compatibility.

Every `vitest.config.ts` loads `tests/guards/no-network.mjs` as a `setupFiles` entry: it patches `fetch`, `net`, `tls`, and `dns` to throw and record any attempt, and fails the test file even if a test swallows the throw. It has no loopback exception. A node child process our own tests spawn (e.g. `packages/storage`'s journal-process fixtures) needs the same guard passed explicitly via `node --import <path-to-guard>`, since `setupFiles` covers only the vitest worker itself; detect an actual vitest worker via `globalThis.__vitest_worker__`, never `process.env.VITEST`, since spawned children inherit that env var without a real vitest runtime to call `afterEach` on. `pnpm`/`tsc` child processes spawned by build tooling (e.g. `packages/cli`'s `bin.test.ts`) are outside this guard's scope. `tests/manual/*.mjs` commands run under bare `node`, deliberately outside every guard, for explicit paid or loopback checks.

## Commit and Review Guidelines

Git history is present. Use focused Conventional Commits such as `feat(session): reconcile interrupted edits` and link `LRN-*` tasks and `LR-FR-*` requirements. Keep changes near 400 lines where practical, excluding generated code and fixtures; documentation scope revisions may be larger.

For this solo learning phase, review the change and record relevant test evidence, security/privacy impact, documentation updates, and screenshots if a TUI is added. The archived two-person/CODEOWNER requirement is deferred until there are actual collaborators or broader distribution. Do not invent reviewer sign-offs or claim an independent security review.
