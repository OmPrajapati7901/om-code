# ADR-024: No LangChain, at Any Layer, for Now

- **Status:** Accepted
- **Date:** 2026-09-06
- **Decision source:** The user asked to evaluate integrating LangChain into the LLM stack; `@langchain/core`/`@langchain/openai` had already landed as the transport under `packages/providers` (uncommitted) before the evaluation started.
- **Related:** [ADR-023](ADR-023-macos-openai-compatible-learning-scope.md), [current backlog](../om-code-agent-execution-backlog.md), [LRN-06/07 evidence](../lrn-06-07-implementation-evidence.md).

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

**Transport.** Reverted to a hand-rolled `fetch` + SSE adapter in `packages/providers`. Measured,
not assumed: the LangChain-based package compiled to 437 non-blank lines against ~326 for the
prior hand-rolled version, even though LangChain owned HTTP, SSE framing, message conversion and
initial-call retries. Roughly 57% of the LangChain-era source existed only to distrust the
framework — a `projection.ts` that explicitly never used LangChain's eagerly-parsed tool-call
arguments, a `guardedFetch` wrapper stripping headers the SDK added, and a hardcoded blocklist of
five `LANGCHAIN_*`/`LANGSMITH_*` env vars worked around a pinned `Runnable.stream` bug. It also
added `@langchain/core`, `@langchain/openai`, `openai`, and `langsmith` (~44 MB) to
`packages/providers`'s dependency graph for a package whose own abstraction —
`ModelProvider.stream(request, signal)` — is three lines and already SDK-agnostic. Adding a
second provider later means writing an adapter behind that port regardless of what sits under
this one; LangChain was not on that critical path.

**Kernel turn loop (LRN-10) — no LangGraph.** Two of this project's own acceptance criteria rule
it out structurally, not by preference: AC-10.1 requires an illegal turn-state transition be a
*type error*, and LangGraph models transitions as runtime string-keyed graph edges; AC-10.5
requires `packages/kernel` import no provider, enforced by `dependency-cruiser` at LRN-14, and
LangGraph pulls `@langchain/core` in directly. Beyond the criteria, the turn loop is the thing
this project exists to learn — the blueprint states the purpose as understanding "the trust
boundary, the session journal, the policy engine, the inference loop" from the inside. The turn
loop's hard parts (journaling before the side effect, reconciling a crash between a tool effect
and its durable result, never auto-repeating an unknown-outcome operation) are specific to this
journal and policy design; a graph framework does not solve them and abstracts away the one part
of the harness the project is for.

**Retrieval / RAG / ecosystem.** No requirement exists in any active plan document. Revisit only
under a written trigger, per the pattern in ADR-023's "Reconsider when."

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

## Reconsider when

A second inference API format is actually being added (not merely anticipated) and its
wire-level differences from Chat Completions are large enough that a shared conversion layer
measurably reduces adapter code — bring evidence, not the framework's reputation. Or: an observed
workflow needs retrieval/RAG and a written trigger names it, per ADR-023's pattern. Do not widen
scope based on LangChain's ecosystem breadth alone; that was true when this ADR was written and
did not change the decision.
