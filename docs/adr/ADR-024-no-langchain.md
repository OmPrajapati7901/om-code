# ADR-024: No LangChain, at Any Layer, for Now

- **Status:** Accepted · **reasoning amended 2026-09-06** (see "Amendment" below — the decision did not change, two of its original arguments did)
- **Date:** 2026-09-06
- **Decision source:** The user asked to evaluate integrating LangChain into the LLM stack; `@langchain/core`/`@langchain/openai` had already landed as the transport under `packages/providers` (uncommitted) before the evaluation started.
- **Related:** [ADR-023](ADR-023-macos-openai-compatible-learning-scope.md), [ADR-025](ADR-025-buy-solved-subsystems.md), [current backlog](../om-code-agent-execution-backlog.md), [LRN-06/07 evidence](../lrn-06-07-implementation-evidence.md).

## Context

LangChain was already wired into `packages/providers` as of 2026-09-06: `ChatOpenAICompletions`
drove every inference call, replacing a hand-rolled `fetch` + SSE transport whose TypeScript
sources had been deleted (they survived only as compiled JS in the gitignored `dist/`). The
change was uncommitted and undocumented. The real question was not whether to adopt LangChain,
but how far up the stack it should go, across three separable layers: the transport seam
(already built), the unbuilt kernel/prompt/tools layers (LRN-08 through LRN-18), and
retrieval/memory (absent from every active plan).

The motivations given for adopting it were: less code to hand-maintain, multi-provider
future-proofing, RAG/ecosystem access, and uncertainty over hand-writing the agent turn loop
versus using LangGraph.

## Decision

Use LangChain, or any agent framework, at none of the three layers for this project, at this
time.

**Transport.** Reverted to a hand-rolled `fetch` + SSE adapter in `packages/providers`.

The governing reason is a mismatch of purpose, not of size. **This adapter's job is adversarial
validation of one untrusted endpoint; a compatibility framework's job is tolerant normalization
across many.** Those are opposite goals, and the requirements are on the strict side of them.
`projection.ts` refuses input that a normalization layer is built to absorb: more than one
`choice`; a `choice.index` other than 0; a response `id` that changes mid-stream; a content delta
arriving after `finish_reason`; conflicting or duplicated tool-call ids; a stream that ends
without `finish_reason` (a typed `disconnected`, not a silent truncation); an 8 MiB character cap.
`mapUsage` demands `Number.isSafeInteger` on both counters or returns `{kind: "unknown"}` — that
is AC-7.4's "never zero, never estimated" enforced at the parse boundary rather than asserted
downstream. Under LangChain every one of those checks had to be re-added on top of the
framework's tolerance, which is why the integration grew rather than shrank.

Three consequences worth stating precisely, because they bound what adopting a framework could
ever have bought:

1. **`ResponseProjection` would exist either way.** It is mandated by the *journal schema*, not by
   the absence of a framework: `RawToolCall.arguments_raw` and `outcome: {kind: "interrupted",
   reason}` are fields of `assistant_message` v2, a persisted entry kind, and `ProviderError.partial`
   carries a structured partial response so AC-7.7 can journal an interrupted assistant message.
   A framework could only ever have replaced `adapter.ts` + `sse.ts` — roughly 280 lines of HTTP,
   SSE framing and retry — with the ~166-line projection staying put.
2. **Parts of `adapter.ts` are security requirements that are hard to verify a framework honors.**
   `redirect: "error"`; `sanitize(failure.message, secret)` scrubbing the credential out of error
   text before it can reach a log or the journal (LR-FR-030); a per-chunk idle timeout distinct
   from the request deadline; an `authorization` header constructed explicitly with nothing else
   attached. The `guardedFetch` header stripping belongs to this category.
3. **The LangSmith env surface is a real scope conflict, not framework-fighting.** `@langchain/core`
   reads tracing environment variables; with `LANGCHAIN_TRACING_V2` set in the ambient environment
   it ships prompts and completions to a hosted service. That is directly against GAP-05 (local
   only, no export) and AC-8.5 (the suite fails if any process opens a socket). The hardcoded
   `LANGCHAIN_*`/`LANGSMITH_*` blocklist was correct.

Cost, secondarily: `@langchain/core`, `@langchain/openai`, `openai` and `langsmith` (~44 MB) in
the dependency graph of the one package that touches the network and handles the credential.

**Kernel turn loop (LRN-10) — no LangGraph.** The decisive incompatibility is durability ordering.
**AC-10.2 requires the journal append to be awaited *before* the side effect it describes.** That
ordering is the foundation of the D-10 crash story: a `tool_call` with no `tool_result` reconciles
to `unknown` and is never re-run. LangGraph checkpoints **after a node completes**, by design.
"Append intent → fsync → then act" cannot be expressed at a LangGraph node boundary without
putting the journal write inside the node — at which point the graph is not providing durability,
we are, and its checkpointer is either dead weight or a second, conflicting record of truth
against a journal that LR-FR-002 declares the single authority.

Two further criteria rule it out structurally rather than by preference: AC-10.1 requires an
illegal turn-state transition be a *type error*, and LangGraph models transitions as runtime
string-keyed graph edges; AC-10.5 requires `packages/kernel` import no provider, enforced by
`dependency-cruiser` at LRN-14, and LangGraph pulls `@langchain/core`'s model abstractions in
directly. And the features LangGraph is genuinely best at — checkpointers, time travel, subgraphs,
multi-agent — are precisely the ones D-04, D-05 and D-06 defer, so adopting it now would pay an
abstraction cost for capability this release decided not to build. Beyond the criteria, the turn
loop is the thing this project exists to learn: the blueprint states the purpose as understanding
"the trust boundary, the session journal, the policy engine, the inference loop" from the inside.

**Retrieval / RAG / ecosystem.** No requirement exists in any active plan document, and
architecture §17.5 independently rejects repo-wide embeddings on cost-and-staleness grounds.
Revisit only under a written trigger, per the pattern in ADR-023's "Reconsider when."

**The layers this ADR originally did not cover,** because they were unbuilt when it was written.
Re-checked 2026-09-06; none of them changes the decision:

| Layer | What LangChain offers | Verdict |
|---|---|---|
| Tool abstraction (LRN-16) | `tool()` / `StructuredTool` expose `invoke()` only — no `plan() → CapabilityRequest`, which AC-16.1 makes mandatory at the type level. The remaining contribution is Zod → JSON Schema, which **Zod 4 does natively** (`z.toJSONSchema()`) | No win |
| Context / compaction (LRN-36, 37) | `trimMessages` trims an in-memory list by token or message count. AC-37.4 requires the post-compaction request be a provable fold of the journal | Different problem |
| Argument repair (LRN-39) | `OutputFixingParser` and peers repair by making another LLM call; AC-39.3 requires a deterministic structured retryable error | No win; use `jsonrepair` per ADR-025 |
| Observability | LangSmith is hosted | Conflicts with GAP-05, AC-8.5 |

## Effect on earlier decisions and documents

- ADR-023's model-port shape stands: `ModelProvider` omits `capabilities()` until a compatibility
  layer has an implemented consumer, and this ADR does not reopen that.
- `docs/lrn-06-07-implementation-evidence.md`'s AC-7.6/SSE-framing claims describe the
  now-reverted LangChain-era behavior for the commit they were written against
  (`feat/provider-langchain`); the current `main`-bound state is the hand-rolled adapter,
  re-verified independently (see the amendment in that document).
- `tests/boundaries.test.ts` continues to hardcode `packages/providers`'s exact dependency list
  (now just `@om-code/protocol`) as a deliberate guardrail: adding `langchain`, `langgraph`, or
  any other framework dependency back in must fail that test until this ADR is revisited.

## Trade-offs

Reverting spent a work session re-solving an already-working transport, and the LangChain-based
adapter's 53 tests were, at the moment of the swap, green. Keeping LangChain would have been
defensible if the goal were shipping quickly rather than learning the mechanism. The team is one
developer; there is no second reviewer whose unfamiliarity with a hand-rolled transport would
have been a cost worth avoiding.

Stated honestly, adopting a framework would still buy something real: ~280 lines of HTTP, SSE
framing and retry we now maintain, and a set of ready provider adapters if this ever becomes
multi-provider. What it costs is the strictness above, the security properties in point 2, the
LangSmith surface in point 3, and dependency churn in the package that holds the credential.

## Reconsider when

**The `ModelProvider` port makes this a per-adapter decision, not a project-wide one.** The port
is three lines. When a second wire format actually arrives, `@langchain/anthropic` — or the vendor
SDK, or another hand-rolled adapter — is a free choice *for that adapter*, sitting beside the
Chat Completions one. There is no need to answer "LangChain or not" globally, which is precisely
why multi-provider future-proofing is not a reason to adopt it *now*: the port already bought that
option, and it cost nothing. So the trigger is not "a second provider is anticipated" but "a
second wire format is being written, and a shared conversion layer measurably reduces *that
adapter's* code" — bring evidence, not the framework's reputation.

**Redo the LangGraph comparison if D-04 or D-05 re-enter scope.** Fork, rewind, subagents and
Directors are where LangGraph's checkpointers and time travel are genuinely on the table, and at
that point "extend the journal" versus "adopt a checkpointer" is a real question rather than a
foregone one. The append-before-effect constraint above is the thing any candidate must satisfy.

**Or:** an observed workflow needs retrieval/RAG and a written trigger names it, per ADR-023's
pattern. Do not widen scope based on LangChain's ecosystem breadth alone; that was true when this
ADR was written and did not change the decision.

## Amendment (2026-09-06) — corrected reasoning, unchanged decision

A build-versus-buy review re-derived this decision from the code rather than from this document,
and found two of the original arguments unsound. They have been replaced above; the outcome did
not move. Recorded here because a decision that is right for the wrong reasons is fragile — it
gets reversed the first time someone checks the reasoning.

| Original claim | Why it was withdrawn |
|---|---|
| "437 non-blank lines against ~326 for the hand-rolled version" | Confounded comparison. It measures a LangChain integration *retrofitted onto a pre-existing bespoke port* against a native implementation of that same port; a LangChain-first design would not have needed some of what was counted. Suggestive, not evidence, and it was carrying more weight than it could bear |
| "`projection.ts` explicitly never used LangChain's eagerly-parsed tool-call arguments" | Overstated. `@langchain/openai` streaming yields `AIMessageChunk` carrying `tool_call_chunks` with **raw string `args` fragments**, alongside the parsed `tool_calls` and `invalid_tool_calls`. The raw fragments are available; we would simply ignore the parsed ones. Modest overhead, not a structural blocker |
| "Roughly 57% existed only to distrust the framework" | Framing rather than analysis. The header stripping and the env blocklist are defensive hygiene worth having regardless — and the env blocklist is now recorded as a genuine GAP-05 / AC-8.5 conflict rather than as an embarrassment |

What replaced them: the strict-versus-tolerant purpose mismatch, the observation that
`ResponseProjection` is mandated by the journal schema and would exist under any transport, and —
for LangGraph — the AC-10.2 append-before-effect incompatibility, which is stronger than anything
the original text argued and was absent from it.
