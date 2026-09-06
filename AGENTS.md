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

The pnpm workspace exists as of LRN-03; `packages/cli` is the only package in it. Do not claim a gate passed without running it.

- `pnpm install --frozen-lockfile` — reproduce pinned TypeScript dependencies.
- `pnpm run check` — the full local gate: lint, typecheck, build, test, in that order.
- `pnpm run lint` (Biome), and `pnpm -r --if-present run typecheck`, `test`, `build` — the individual gates; required packages must define these scripts.
- `pretypecheck` builds the workspace first, so a package typechecks against the built declarations of the workspace packages it imports (rather than their sources).
- `pnpm add --global ./packages/cli` — put `om` on your PATH. `pnpm link --global` was removed in pnpm 11, and `~/Library/pnpm/bin` must be on PATH first (`pnpm setup`).

There is no `pnpm dev` yet: no long-running development workflow exists until `om run` lands in LRN-11.

Rust is not in this repository yet — the Cargo workspace and `native/om-stub` arrive in M4 (LRN-30), and until then these are the commands that will apply, not commands you can run:

- `cargo build --locked` and `cargo test --locked` — build and test Rust crates.
- `cargo fmt --check` and `cargo clippy --locked -- -D warnings` — enforce Rust style and linting.

Run actual sandbox tests on the supported macOS target. Default tests use fake providers and must not spend inference credits. Turbo, Python/uv, other-platform runners, public packaging, and signing credentials are not initial prerequisites.

## Coding Style and Architectural Boundaries

Use Biome for TypeScript, and rustfmt/Clippy for Rust. Use ATX headings, concise Markdown, and tables when they improve comparison. Name packages by responsibility and branches in kebab-case, such as `feat/session-journal`.

Keep provider-specific logic and SDK types out of `packages/kernel`. `packages/protocol` is the wire-schema authority; Rust DTOs are generated or schema-checked mirrors. `packages/sandbox` and `packages/stub-client` depend on protocol contracts, not each other; the CLI composes them.

All workspace reads, searches, writes, and command execution route through `packages/stub-client` to the sandboxed stub. Trusted host application-state reads/writes belong to `packages/storage` and are limited to application-owned configuration, journals, locks, and backups. Do not misapply the workspace I/O rule to force journal storage inside the sandbox. Host launch/setup effects are confined to reviewed boundary integration modules; document any sandbox dependency that performs them internally.

## Testing Guidelines

Use Vitest for unit, contract, and integration tests; fast-check for focused TypeScript properties; and Rust proptest for path/protocol invariants. Every behavioral fix needs a regression test named for its issue. Security-sensitive changes under `native/`, `packages/policy`, `packages/sandbox`, or `packages/stub-client` also require the relevant macOS escape suite.

Cover stale edits, approval invalidation, incomplete tool streams, unknown usage, cancellation, and crashes between a tool effect and its durable result. Never automatically repeat an arbitrary command with an unknown outcome. Checks establish their tested scope; they do not establish universal sandbox safety or endpoint compatibility.

## Commit and Review Guidelines

Git history is not present in this checkout. When git is initialized, use focused Conventional Commits such as `feat(session): reconcile interrupted edits` and link `LRN-*` tasks and `LR-FR-*` requirements. Keep changes near 400 lines where practical, excluding generated code and fixtures; documentation scope revisions may be larger.

For this solo learning phase, review the change and record relevant test evidence, security/privacy impact, documentation updates, and screenshots if a TUI is added. The archived two-person/CODEOWNER requirement is deferred until there are actual collaborators or broader distribution. Do not invent reviewer sign-offs or claim an independent security review.
