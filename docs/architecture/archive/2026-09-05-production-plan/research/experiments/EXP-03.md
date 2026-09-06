# EXP-03 Pre-Registration: Journal-Only State and Replay Fidelity

> **Current scope notice (2026-09-05): deferred research plan.** This document's original design and pre-registration labels are preserved below. Its platform/model requirements, section references, and release gates refer to the [archived production blueprint](../../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md), not the current learning release. It does not block macOS/OpenAI-compatible implementation. Before resuming this study, create a dated scope amendment under [ADR-023](../../adr/ADR-023-macos-openai-compatible-learning-scope.md); no experiment execution or result is implied by this document.

- **Status:** Pre-registered
- **Pre-registration date:** 2026-09-05
- **Research question:** RQ-2 — Does the "all behaviour-affecting state is
  journaled" rule make rewind/fork/resume faithful in the presence of
  third-party extensions?
- **Hypothesis:** H3 — Journal-only state yields 100% replay fidelity even
  with adversarial extensions. Falsifiable prediction: 0 mismatches in
  1,000 randomized rewind/fork/resume property runs under `journal_only`;
  more than 0 (and quantified) under `relaxed`.
- **Decision this gates:** ADR-003 (JSONL entity-patch journal as single
  authority) and ADR-004 (no behaviour-affecting state outside the
  journal — "Reconsider when: Never — this is the study's core claim,
  tested by H3").

## 1. Design

Property-based, fully deterministic — no model in the loop. A property
test generator produces randomized sequences of session operations
(patches, forks, rewinds, resumes) combined with 12 adversarial plugins
designed to hold state outside the sanctioned channel. Each generated
sequence is executed once under each arm; the resulting session state is
compared against a replay reconstructed purely from the journal.

## 2. Variables

- **Independent variable:** state discipline — `journal_only` vs `relaxed`.
- **Arms:**
  | Arm | State discipline | Difference from internal baseline |
  |---|---|---|
  | A | `journal_only` | Proposed architecture: `session.state.declare()` is the only state channel (ADR-004); no module-level state API exists. |
  | B | `relaxed` | Internal baseline (methodology §5): extensions may hold state outside the journal (e.g., module-level variables), as most existing harnesses allow. |
- **Controlled variables:** harness commit SHA; the same 12 adversarial
  plugins and the same generated operation sequences run under both arms
  (paired by construction); no model involved; property-test random seed
  recorded per sequence so any failing case is reproducible in isolation.
- **Dependent variables:** replay divergence count (primary) — a mismatch
  between live session state and journal-replayed state after a
  rewind/fork/resume; divergence category (secondary, exploratory — which
  of the 12 plugins or which operation type produced the mismatch).

## 3. Dataset

1,000 randomized operation sequences × 12 adversarial plugins (the plugins
are fixed fixtures checked into `evals/`, each designed to violate the
journal-only discipline in a distinct way — e.g., caching a value in a
closure, writing to a module-level map, spawning a timer that mutates
state after the turn ends).

## 4. N

1,000 sequences per arm, as specified in blueprint §28.3. Fixed by design
— this is a property-based test over a generated input space, not a
variance-driven sample-size question, so GAP-08's pilot does not apply
here. (GAP-08 names EXP-04/05/06 specifically.)

## 5. Primary metric

Replay divergence count: the number of sequences (out of 1,000) where
post-rewind/fork/resume state differs from the journal-only reconstruction
of that state.

## 6. Success threshold

Arm A (`journal_only`): 0 divergences across all 1,000 sequences × 12
plugins. Arm B (`relaxed`): > 0 divergences, expected and quantified (this
arm is expected to fail — it demonstrates the problem ADR-004 solves, not
a competing viable design). If Arm A produces any divergence, H3 is
refuted and ADR-004's reversal trigger applies immediately, since the ADR
itself states this hypothesis is its core claim.

## 7. Analysis method

Divergence rate (divergent sequences / 1,000) per arm, with a 95%
Clopper–Pearson exact confidence interval given the expected rate at or
near the boundary (0 for arm A). No correction needed within EXP-03 itself
(single primary comparison: arm A's divergence rate against the 0
threshold); Holm–Bonferroni applies across H1–H6 in the combined report.

## 8. Exclusion rules

A sequence is excluded, with a reason recorded in
`experiments/index.jsonl`, if: the property-test generator itself produces
an invalid sequence (fails schema/manifest validation before execution,
FR-036); the test harness crashes for a reason unrelated to the state
discipline under test (e.g., an out-of-memory condition on the test
runner unrelated to the generated sequence's size); or the worktree is
dirty at run time. Excluded sequences are re-generated and re-run to keep
N at 1,000 per arm, not dropped from the denominator.

## 9. Deviations

None (initial pre-registration).
