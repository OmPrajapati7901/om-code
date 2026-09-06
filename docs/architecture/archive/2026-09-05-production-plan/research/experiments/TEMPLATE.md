# EXP-XX Pre-Registration: <Title>

> **Current scope notice (2026-09-05): deferred research plan.** This document's original design and pre-registration labels are preserved below. Its platform/model requirements, section references, and release gates refer to the [archived production blueprint](../../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md), not the current learning release. It does not block macOS/OpenAI-compatible implementation. Before resuming this study, create a dated scope amendment under [ADR-023](../../adr/ADR-023-macos-openai-compatible-learning-scope.md); no experiment execution or result is implied by this document.

> Copy this file to `EXP-XX.md`, fill every field, remove this notice, and
> commit before the experiment's first run. See
> `docs/research/methodology.md` §7–8 for the amendment process: changing
> a field after the first run requires a new tag and a "Deviations" entry
> in the eventual report.

- **Status:** Pre-registered | Amended | Superseded
- **Pre-registration date:** YYYY-MM-DD
- **Research question:** RQ-N (state it in full)
- **Hypothesis:** HN (state the falsifiable prediction in full)
- **Decision this gates:** ADR-NNN

## 1. Design

Design type (adversarial suite / property-based / factorial / within-task /
public benchmark) and a one-paragraph description of the procedure.

## 2. Variables

- **Independent variable(s):** name, and the exact values tested.
- **Arms:** one row per arm — arm id, the independent variable's value in
  that arm, and how it differs from the internal baseline
  (`docs/research/methodology.md` §5).
- **Controlled variables:** everything held fixed across arms (model +
  version, temperature/seed, dataset commit, container image digest,
  hardware class, network egress policy, concurrency, harness commit SHA,
  all other flags at default, task order + recorded seed).
- **Dependent variable(s) / metrics measured:** every metric this
  experiment records, even ones not used in the primary analysis.

## 3. Dataset

Dataset identity, version/commit, size (task or case count), and where it
lives (`evals/...` path or external benchmark name + pinned commit).

## 4. N (sample size)

State N per arm, and how it was set: a fixed count justified by the design
(e.g., deterministic corpus size), or "pending pilot (GAP-08)" with the
provisional N to use until the pilot's variance estimate lands. If
pending, name the pilot that will resolve it and the phase it runs in.

## 5. Primary metric

The single metric the success threshold is evaluated against. Name any
secondary metrics separately and mark them exploratory.

## 6. Success threshold

The exact, numeric, falsifiable condition that counts as support for the
hypothesis, and what result would count as refuting it. A threshold that
cannot fail is not a valid pre-registration.

## 7. Analysis method

Statistical method (exact counts, bootstrap CI, mixed-effects model,
proportions with Wilson CIs, etc.), the correction applied across multiple
comparisons (Holm–Bonferroni across H1–H6 per methodology §7), and the
confidence level used (95% unless stated otherwise).

## 8. Exclusion rules

State, in advance, every condition under which a run is excluded from the
analysis (e.g., dirty worktree, manifest validation failure, infrastructure
crash unrelated to the treatment, container digest mismatch, timeout from
an external dependency outage). Excluded runs are still recorded in
`experiments/index.jsonl` and listed with reasons in the report — never
silently dropped.

## 9. Deviations

(Left empty at pre-registration time. Filled in only if this file is
amended after the experiment's first run — see methodology §7–8.)
