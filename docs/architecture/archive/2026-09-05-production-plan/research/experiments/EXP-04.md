# EXP-04 Pre-Registration: Tool-Roster Size Effect

> **Current scope notice (2026-09-05): deferred research plan.** This document's original design and pre-registration labels are preserved below. Its platform/model requirements, section references, and release gates refer to the [archived production blueprint](../../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md), not the current learning release. It does not block macOS/OpenAI-compatible implementation. Before resuming this study, create a dated scope amendment under [ADR-023](../../adr/ADR-023-macos-openai-compatible-learning-scope.md); no experiment execution or result is implied by this document.

- **Status:** Pre-registered
- **Pre-registration date:** 2026-09-05
- **Research question:** RQ-3 — How does permanent tool-roster size affect
  wall-clock latency, output tokens and task success rate?
- **Hypothesis:** H4 — Roster size has a material, model-independent-in-
  direction effect on wall-clock. Falsifiable prediction: ≥ 20% wall-clock
  reduction going from 20+ tools to ≤ 8, on at least 2 of 3 models.
- **Decision this gates:** ADR-009 (permanent roster ≤ 8; long tail via
  `dyn` CLI).

## 1. Design

3×3 factorial, randomized task order, live models in the loop (not
deterministic). Roster size is manipulated while the long-tail-access
mechanism (`dyn`) is held available in every arm so the comparison isolates
roster size, not tool availability.

## 2. Variables

- **Independent variable:** permanent roster size — `3` | `8` | `23`.
- **Arms:**
  | Arm | Roster size | Difference from internal baseline |
  |---|---|---|
  | roster_3 | 3 permanent tools | Below the proposed default; tests the lower bound. |
  | roster_8 | 8 permanent tools | Proposed architecture (ADR-009). |
  | roster_23 | 23 permanent tools | Internal baseline (methodology §5): the configuration closest to a naive harness. |
- **Controlled variables:** dataset (20 Terminal-Bench 2.0 tasks + 10
  internal, fixed set across arms); model + version per model family
  (temperature = 0 / fixed seed where the provider supports it); container
  image digest; hardware class; network egress policy; concurrency capped
  per config default; harness commit SHA; all other flags at default; task
  order randomized per repeat with a recorded seed.
- **Dependent variables:** wall-clock to completion (primary); task success,
  binary per task (primary); output tokens (primary); input/cache tokens,
  USD cost, tool-call count (secondary, exploratory).

## 3. Dataset

20 Terminal-Bench 2.0 tasks (pinned commit, per §28.4's external-baseline
convention) plus 10 internal tasks, for 30 tasks total per model per arm
per repeat.

## 4. N

**Pending pilot (GAP-08).** Minimum N is derived from the P3 pilot (5
tasks × 5 repeats) once its variance estimate lands; that pilot is
explicitly scoped to EXP-04/05/06 in blueprint GAP-08. Until the pilot
completes, the provisional N is **3 models × 30 tasks × 3 arms × 5
repeats = 1,350 runs**, matching the budget estimate in methodology §9.
This file will be amended with the pilot-derived N before EXP-04's first
full run; per methodology §7–8, that amendment is made before the first
run and therefore does not require a "Deviations" entry (the pilot result
is the trigger this section already anticipates, not a post-hoc change).
Model families and total inference budget are pending your input
(backlog Blocker B4) and will be filled in here once decided.

## 5. Primary metric

Wall-clock to completion (primary metric for the success threshold); task
success rate and output tokens are also primary in the sense of being
pre-registered and reported with full statistical rigor, but the
threshold below is stated in terms of wall-clock per H4's falsifiable
prediction.

## 6. Success threshold

≥ 20% wall-clock reduction going from `roster_23` to `roster_8`, on at
least 2 of the 3 model families tested, **without** a statistically
significant drop in task success rate (assessed via the mixed-effects
model in §7 — a wall-clock win that comes with a success-rate loss outside
noise does not count as support for H4). If wall-clock reduction is < 20%
on fewer than 2 models, or if it comes with a significant success-rate
drop, H4 is refuted and ADR-009 is flagged for reconsideration (its stated
reversal trigger: "EXP-04 fails to reproduce the effect").

## 7. Analysis method

Mixed-effects model with task and model as random effects, roster size as
the fixed effect, per methodology §7. Holm–Bonferroni correction applied
across the primary hypotheses (H1–H6) in the combined report — within
EXP-04 itself, wall-clock, success rate and output tokens are each
reported with their own 95% CI, with wall-clock designated primary for the
threshold decision and the other two reported as corroborating or
disconfirming evidence, not independently thresholded.

## 8. Exclusion rules

A run is excluded, with a reason recorded in `experiments/index.jsonl`, if:
the manifest fails validation before execution (FR-036); the container
digest does not match the pinned digest; a provider outage or rate limit
prevents task completion for reasons unrelated to roster size (recorded via
the typed `provider_error`); the worktree is dirty at run time; or a task
is marked invalid by the Terminal-Bench harness itself (a pre-existing
task-definition bug, not a harness-under-test failure). Excluded runs are
re-run to preserve the target N per cell, not dropped without replacement,
except where a task is excluded across all arms (e.g., a broken task
definition), in which case it is dropped from the dataset for this
experiment and noted in the report.

## 9. Deviations

None (initial pre-registration). Expect one anticipated amendment once the
P3 pilot lands a variance-derived N, as described in §4 — that amendment
is pre-anticipated here and does not itself count as a deviation provided
it lands before EXP-04's first full run.
