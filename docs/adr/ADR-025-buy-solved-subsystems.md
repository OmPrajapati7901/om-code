# ADR-025: Buy the Solved Subsystems, Build the Boundary

- **Status:** Accepted
- **Date:** 2026-09-06
- **Decision source:** A build-versus-buy review of the three planning documents, run against the shipped M1 code and the unbuilt M2–M5 backlog.
- **Related:** [ADR-023](ADR-023-macos-openai-compatible-learning-scope.md) (scope), [ADR-024](ADR-024-no-langchain.md) (no agent framework), [blueprint](../om-code-master-delivery-blueprint.md), [backlog](../om-code-agent-execution-backlog.md).

## Context

ADR-024 answered "should a framework own the loop?" — no. It did not answer the narrower and more
frequent question: for each individual subsystem M2–M5 is about to build, is there a mature,
well-scoped library or OS capability that does the job better than we would?

Six places in the backlog assume a hand-rolled implementation of something that is genuinely
solved elsewhere. In one of them — shell decomposition — the hand-rolled version does not merely
cost more time, it yields a *weaker security property* than the alternative. Left unstated, the
default is "write it," because that is what the acceptance criteria imply.

This ADR fixes the per-subsystem answers so they are decided once rather than re-litigated at each
task, and states what stays custom so that "buy" does not creep into the parts that are the
product.

## Decision

### Buy

| # | Subsystem | Choice | Replaces | Reversal trigger |
|---|---|---|---|---|
| 1 | **Shell decomposition** (LRN-27) | `tree-sitter-bash` — `web-tree-sitter` on the host, the `tree-sitter`/`tree-sitter-bash` crates in the stub | A hand-written splitter, quoting state machine and here-doc handling | The grammar proves unable to represent a construct policy must reason about, recorded with the case |
| 2 | **Code search** (LRN-13) | The `ripgrep` binary via `rg --json` from the `local-ts` driver; `grep-searcher`/`ignore`/`globset` in the Rust stub as already planned | A gitignore-precedence implementation, glob matcher, bounded line scanner — written twice | Requiring `rg` on PATH becomes a real friction point; fall back to `ignore` + `tinyglobby` |
| 3 | **Tokenizer** (LRN-36) | `gpt-tokenizer` as a *named approximation*, used only where the endpoint reports no `usage` | A BPE implementation and vocabulary | The active model's own tokenizer is needed for a decision, not just a display |
| 4 | **JSON argument repair** (LRN-39) | `jsonrepair`, wrapped so its output is a candidate that must re-validate against the tool's Zod schema | A JSON grammar-recovery parser | Never — but the wrapper, not the library, owns the refuse-rather-than-guess semantics |
| 5 | **Diff generation** (LRN-22, LRN-23) | `diff` (jsdiff) `structuredPatch`/`createTwoFilesPatch`, `picocolors` for rendering, `fastest-levenshtein` for candidate ranking | A Myers diff and hunk formatter | Never |
| 6 | **Rust DTO mirroring** (LRN-30) | Zod 4's native `z.toJSONSchema()` as the single source; Rust structs hand-written with `schemars`, and a test asserting the two JSON Schemas are equal. `serde_jcs` for RFC 8785 canonicalization | A bespoke codegen pipeline, or hand-maintained twins that drift | Schema-equality checking proves too coarse; switch to generating with `typify` |
| 8 | **Secret scanning** (LRN-41) | `gitleaks` over test artifacts in CI, with the planted-key fixture retained as the negative control | A hand-written credential regex set | Never |
| 9 | **Path/glob predicates in policy** (LRN-21) | `picomatch`, behind our own predicate type | Hand-rolled glob semantics | Never |
| 10 | **Module-import bans** (LRN-14) | Biome `noRestrictedImports` with path-scoped overrides for AC-14.1; `dependency-cruiser` retained for the AC-14.4 layering graph | A second tool for a rule Biome already runs on every save | — |

Numbering follows the review's finding numbers; 7 and 11 are recorded below rather than in the
table because they are a process change and an optional M5 nicety.

**7 — `@anthropic-ai/sandbox-runtime` stays the choice, but the purchase is spiked early.** Two
things must be true of it and neither is guaranteed at `0.0.x`: it must wrap a *long-lived* child
process, and it must expose the *generated profile text*, because AC-33.4 requires `health` to
report the profile in force and the host to verify it matches what it requested. If the package
generates the profile internally and does not hand it back, AC-33.4 is unimplementable against it.
A one-evening spike lands in M2/M3 rather than M4 (backlog LRN-13b). The known fallback is
generating the `.sb` profile ourselves and invoking `/usr/bin/sandbox-exec`; the placement port
already makes that a driver swap.

**11 — terminal markdown rendering** (`marked` + `marked-terminal`) is available for M5 if LRN-43
shows it matters. It lives entirely in the render layer and does not reopen D-02. External text is
sanitized with Node's built-in `util.stripVTControlCharacters` *before* rendering, which makes
architecture §7.6's first constraint enforceable now rather than when a TUI arrives.

### Build

Restated so that "buy" does not erode them:

- **The session journal, its locking, its repair and its commit points.** No library offers the
  combination, and it is the correctness core.
- **The turn FSM.** Per ADR-024, decisively because of AC-10.2's append-before-effect ordering.
- **The policy decision core** — precedence, tiers, modes, fail-closed. Cedar or OPA would be
  over-engineering for a space small enough to test exhaustively, and an exhaustive matrix over a
  small space is *stronger* assurance than a general engine. `picomatch` covers path predicates
  only.
- **The `str_replace` engine.** Its value is entirely in *refusal* semantics; patch libraries all
  optimize for applying.
- **Checkpoints.** A git-shadow checkpoint drags in ignore-rule interactions and index locking
  against the user's own repository. Copying the prior bytes of exactly the files about to be
  written is simpler and matches AC-25.3. On APFS, `fs.copyFile(…, COPYFILE_FICLONE)` makes that
  copy a copy-on-write clone.
- **The executor stub and its RPC.** This is the architecture. `vscode-jsonrpc` fits poorly because
  the port is stream-shaped (AC-12.3 async iterables) and its progress model is awkward for that.
- **The config loader** (source attribution is the requirement, AC-4.2), **structured local logs**
  (`pino` is the right library at the wrong volume, and redaction must run before *journaling*
  anyway), **CLI argument parsing**, and **SSE framing** — all shipped, small, and tested.
- **The escape suite, crash harness, `om replay` and `om doctor`.** Assertions about our own
  boundary and journal; nothing to buy.

### Consequence for the port contract

Findings 2 and 6 expose one gap that must close in M2, not M4. AC-30.5 requires the Rust stub to
pass the LRN-13 driver contract suite *verbatim*, and says any change required to the suite is a
defect in the port. But ripgrep uses the Rust `regex` crate (RE2-style: no backreferences, no
lookaround) while Node uses JS `RegExp`; and Node `realpath` differs from Rust `canonicalize` on
macOS Unicode normalization and case-insensitivity. A contract test written naturally in M2 can
pass then and fail in M4, and the AC would misdiagnose that as a port leak when it is really an
unspecified contract.

**Therefore the regex dialect and the path-canonicalization semantics become part of the port
contract at LRN-12** (new AC-12.6), with unsupported constructs rejected at the boundary as a typed
error. Likewise, the protocol's JSON Schema emit and a canonical-JSON golden-vector fixture land in
M2 so that LRN-30's cross-language hash agreement is a comparison rather than a discovery.

## Trade-offs

Ten dependencies enter a project that has been deliberate about having few, and each is a supply-
chain surface and an upgrade obligation. Two carry specific risk: `tree-sitter-bash`'s wasm build
may need producing and vendoring once, and requiring `rg` on PATH adds an install step that
`om doctor` has to check and explain.

Against that: every one of them is confined behind an interface the plan already defines, none of
them touches `packages/providers`' dependency list (so ADR-024's `tests/boundaries.test.ts`
guardrail is unaffected), and the alternative is hand-maintaining six subsystems whose failure
modes are well documented in other people's issue trackers.

The reversal cost is low in every case because adoption happens *inside* a module the architecture
already isolates — a tool, a driver, a renderer — never at a boundary.

## Reconsider when

Per row above. Globally: if a dependency's maintenance stalls or its API churns enough to cost more
than the code it replaced, drop it and write the narrow version — the interfaces make that a
contained change, which is the entire reason the purchases are safe.
