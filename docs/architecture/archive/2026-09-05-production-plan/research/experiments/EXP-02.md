# EXP-02 Pre-Registration: Stub RPC Latency Cost

> **Current scope notice (2026-09-05): deferred research plan.** This document's original design and pre-registration labels are preserved below. Its platform/model requirements, section references, and release gates refer to the [archived production blueprint](../../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md), not the current learning release. It does not block macOS/OpenAI-compatible implementation. Before resuming this study, create a dated scope amendment under [ADR-023](../../adr/ADR-023-macos-openai-compatible-learning-scope.md); no experiment execution or result is implied by this document.

- **Status:** Pre-registered
- **Pre-registration date:** 2026-09-05
- **Research question:** RQ-1 — Does moving all execution behind a single
  stub RPC prevent the escape classes that per-command sandboxing leaves
  open, and at what latency cost?
- **Hypothesis:** H2 — The latency cost of stub RPC is small relative to
  model latency. Falsifiable prediction: added p95 latency per tool call
  ≤ 25 ms locally, and ≤ 5% of end-to-end turn wall-clock.
- **Decision this gates:** ADR-002 (reversal trigger: "stub overhead >
  NFR-003 after optimization").

## 1. Design

Two-part latency measurement: (a) a micro-benchmark isolating per-call RPC
overhead across 200 synthetic tool calls, and (b) an end-to-end measurement
across 20 golden tasks to place that overhead in the context of full turn
wall-clock, which includes model latency.

## 2. Variables

- **Independent variable:** boundary mode — `stub` vs `per_command`.
- **Arms:**
  | Arm | Boundary mode | Difference from internal baseline |
  |---|---|---|
  | A | `stub` | Proposed architecture: JSON-RPC over stdio to the executor stub (C7/C8). |
  | B | `per_command` | Internal baseline (methodology §5): sandboxing applied per invoked command, no stub round trip. |
- **Controlled variables:** harness commit SHA; hardware class (fixed
  runner spec, recorded); model + version held fixed for the end-to-end
  arm (a single representative model, since this experiment measures
  boundary overhead, not model variance); network egress policy;
  concurrency = 1 task at a time; task order randomized with a recorded
  seed for the 20 golden tasks; the 200 synthetic tool calls run in a
  fixed, recorded order (not randomized — same call sequence in both arms
  to keep the paired comparison exact).
- **Dependent variables:** p95 added latency per tool call (primary, from
  the micro-benchmark); % of turn wall-clock attributable to the boundary
  (primary, from the end-to-end tasks); mean/median latency and full
  distribution (secondary, exploratory).

## 3. Dataset

200 synthetic tool calls (a fixed, representative mix of `exec`/`read`/
`write`/`glob`/`grep` calls with varied payload sizes) plus 20 golden
tasks (a fixed internal task set used for end-to-end timing, distinct from
the Terminal-Bench tasks used in EXP-04/EXP-08 to avoid cross-experiment
contamination of any caching or familiarity effects).

## 4. N

5 repeats of the full 200-call micro-benchmark and the 20-task end-to-end
run, per arm. Fixed by design — this is a controlled timing measurement on
a deterministic call sequence, not a variance-driven sample-size question,
so GAP-08's pilot does not apply here.

## 5. Primary metric

p95 added latency per tool call (micro-benchmark); percentage of total
turn wall-clock spent in the boundary (end-to-end).

## 6. Success threshold

p95 added latency ≤ 25 ms locally, **and** boundary overhead ≤ 5% of
end-to-end turn wall-clock, both on arm A. If either threshold is missed,
H2 is refuted and the ADR-002 reversal trigger is evaluated against
NFR-003 to decide whether optimization work is required before the
architecture proceeds unmodified.

## 7. Analysis method

Bootstrap confidence intervals (95%, 10,000 resamples) on paired medians
between arm A and arm B, paired by call index (micro-benchmark) or task id
(end-to-end). p95 reported with its own bootstrap CI. No hypothesis test
beyond the CI-based threshold check — this experiment has one primary
comparison, so no multiple-comparison correction is needed within EXP-02
itself (Holm–Bonferroni applies across H1–H6 in the eventual combined
report, per methodology §7).

## 8. Exclusion rules

A run is excluded, with a reason recorded in `experiments/index.jsonl`, if:
the manifest fails validation before execution; a tool call fails for a
reason unrelated to the boundary under test (e.g., a transient filesystem
error on the test runner, a golden task's fixture is corrupted); the
runner's CPU/network was contended by another process during the timing
window (checked via a recorded load-average sample per run); or the
worktree is dirty at run time. Repeats affected by exclusion are re-run,
not dropped from N without replacement.

## 9. Deviations

None (initial pre-registration).
