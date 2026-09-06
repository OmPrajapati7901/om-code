# om-code Research Validation Methodology

> **Current scope notice (2026-09-05): deferred research plan.** This document's original design and pre-registration labels are preserved below. Its platform/model requirements, section references, and release gates refer to the [archived production blueprint](../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md), not the current learning release. It does not block macOS/OpenAI-compatible implementation. Before resuming this study, create a dated scope amendment under [ADR-023](../adr/ADR-023-macos-openai-compatible-learning-scope.md); no experiment execution or result is implied by this document.

**Source:** blueprint §4 (Research Questions and Hypotheses), §28 (Research
Validation Methodology), §29 (Experiment Reproducibility).

## 1. Separation of concerns

Two different questions get answered by two different mechanisms, and
neither substitutes for the other:

- **Software acceptance** — "does the system behave as specified?" —
  answered by the test suites in §26/§27, and gates phases and releases.
- **Research validation** — "does the evidence support or reject H1–H6?" —
  answered by the experiments below, and gates
  `v0.5.0-validation-complete`.

A green test suite is never cited as research evidence. A favourable
experiment result is never cited as satisfying a failing requirement.

## 2. Research questions and hypotheses

| ID | Question | Answered by |
|---|---|---|
| RQ-1 | Does moving all execution behind a single stub RPC prevent the escape classes that per-command sandboxing leaves open, and at what latency cost? | EXP-01, EXP-02 |
| RQ-2 | Does the "all behaviour-affecting state is journaled" rule make rewind/fork/resume faithful in the presence of third-party extensions? | EXP-03 |
| RQ-3 | How does permanent tool-roster size affect wall-clock latency, output tokens and task success rate? | EXP-04 |
| RQ-4 | Which edit format maximises apply rate per model class, and does a per-model selection policy beat any single format? | EXP-05 |
| RQ-5 | Does speculative compaction reduce user-perceived stall without degrading task success versus blocking compaction; does provider-native compaction beat both? | EXP-06 |
| RQ-6 | Do capability-based policies with sandbox backing block destructive/exfiltration attempts that pattern-based rules miss? | EXP-07 |
| RQ-7 | Is the harness competitive on a public benchmark, i.e. does the architecture cost task success? | EXP-08 |
| RQ-8 | Does an in-process bash interpreter raise approval precision enough to justify its cost? | EXP-09 (stretch, gated on GAP-09) |

| ID | Hypothesis | Falsifiable prediction | Decision it gates |
|---|---|---|---|
| H1 | Stub-only execution blocks all escape-test classes that per-command sandboxing leaves open | Escape suite: 100% blocked in stub mode; ≥ 3 classes reachable in per-command mode | ADR-002 |
| H2 | The latency cost of stub RPC is small relative to model latency | Added p95 per tool call ≤ 25 ms local; ≤ 5% of end-to-end turn time | ADR-002 (reversal trigger) |
| H3 | Journal-only state yields 100% replay fidelity even with adversarial extensions | 0 mismatches in 1,000 randomized rewind/fork/resume property runs | ADR-003 |
| H4 | Roster size has a material, model-independent-in-direction effect on wall-clock | ≥ 20% wall-clock reduction going from 20+ tools to ≤ 8, on ≥ 2 of 3 models | ADR-009 |
| H5 | No single edit format dominates across model classes | Per-model policy beats the best single format by ≥ 3 points apply rate | ADR-010 |
| H6 | Speculative compaction removes the stall without hurting success | ≥ 70% reduction in post-threshold stall; task success within noise | ADR-011 |

Each hypothesis gates a specific ADR: a falsified hypothesis is a scheduled
reconsideration of that decision, not a surprise.

## 3. Variables

**Independent** (one per experiment, set by a typed flag — ADR-016):
boundary mode (`stub` | `per_command`) · state discipline (`journal_only` |
`relaxed`) · roster size (`3` | `8` | `23`) · edit format (`str_replace` |
`v4a` | `whole` | `hashline` | `policy`) · compaction strategy (`blocking` |
`speculative` | `native`) · policy mode (`capability` | `pattern_only`).

**Dependent:** task success (binary per task), wall-clock to completion,
input/output/cache tokens, USD cost, tool-call count, edit apply rate, edit
repair rate, post-threshold stall (ms), escape-classes-blocked, replay
divergence count, p95 stub RPC latency.

**Controlled:** model + version, temperature/seed where supported, dataset
commit, container image digest, hardware class, network egress policy,
concurrency, harness commit SHA, all other flags at their defaults, task
order (randomized with a recorded seed).

Every experiment varies exactly one independent variable across its arms;
everything else is held at a documented default or explicitly controlled.

## 4. Experiment index

| ID | RQ/H | Design | Arms | Dataset | N | Primary metric | Success threshold |
|---|---|---|---|---|---|---|---|
| EXP-01 | RQ-1/H1 | Adversarial suite, deterministic (no model) | A `stub`, B `per_command` | `evals/escape_tests` (8 classes × 5 variants, 3 OSes) | 120 per arm per OS | Escape classes blocked | A blocks 100%; B leaves ≥ 3 classes reachable |
| EXP-02 | RQ-1/H2 | Micro + end-to-end latency | A `stub`, B `per_command` | 200 synthetic tool calls + 20 golden tasks | 5 repeats | p95 added latency; % of turn wall-clock | ≤ 25 ms p95; ≤ 5% of turn |
| EXP-03 | RQ-2/H3 | Property-based, deterministic | A `journal_only`, B `relaxed` | 1,000 randomized op sequences × 12 adversarial plugins | 1,000 per arm | Replay divergences | A = 0; B > 0 (expected, quantified) |
| EXP-04 | RQ-3/H4 | 3×3 factorial, randomized order | roster 3 / 8 / 23 | 20 Terminal-Bench 2.0 tasks + 10 internal | 3 models × 5 repeats (provisional — see EXP-04 pre-registration) | Wall-clock; success; output tokens | ≥ 20% wall-clock reduction 23→8 on ≥ 2 models |
| EXP-05…09 | — | — | — | — | — | — | pre-registered separately (task 3) |

Full per-experiment pre-registrations, including exclusion rules and
analysis method, live in `docs/research/experiments/EXP-XX.md`, one file
per experiment, using the template in
`docs/research/experiments/TEMPLATE.md`.

## 5. Baselines

**Internal baseline:** `per_command` boundary, `relaxed` state, roster 23,
`str_replace`-only, `blocking` compaction, `pattern_only` policy — the
configuration closest to a naive harness. Every experiment's "B" arm or
default configuration traces back to this baseline unless the experiment's
pre-registration states otherwise.

**External baseline (descriptive only, not a head-to-head claim):**
published Terminal-Bench 2.0 numbers where the same pinned task set and
model are used. Differences in scaffolding are stated as a limitation
rather than adjusted away.

## 6. Data collection and evidence storage

Each run writes: the manifest (§29 schema), raw stdout/stderr and journal
per task (content-addressed), extracted metrics (JSON), and the analysis
inputs.

- `experiments/index.jsonl` — append-only run index, committed to git.
- `experiments/results/<sha256>/` — large artifacts (storage backend per
  ADR/decision on GAP-05's sibling gap for experiment storage — see
  Blockers B5 in the backlog).

Nothing is edited after the fact. Corrections are new runs that reference
the superseded run id in their manifest.

## 7. Statistical handling

- Pre-register thresholds in `docs/research/experiments/EXP-XX.md` **before
  the first run** of that experiment. A pre-registration is dated at
  creation; changing it after the first run requires a new git tag and a
  note in the eventual report's limitations section (see §8).
- Report effect sizes with 95% confidence intervals, not only p-values.
- Use mixed-effects models where tasks and models are crossed (EXP-04,
  EXP-05, EXP-06).
- Apply Holm–Bonferroni correction across the primary hypotheses (H1–H6).
  Any comparison not named in a pre-registration is exploratory and must be
  labeled as such in the report.
- Minimum N for EXP-04/05/06 is derived from P3 pilot variance (GAP-08,
  pilot: 5 tasks × 5 repeats). Until that pilot completes, N for those
  experiments is provisional and marked "pending pilot" in the relevant
  pre-registration.
- Failed or excluded runs are listed with reasons in the report — never
  silently dropped. Each experiment's pre-registration states its own
  exclusion rules in advance.

## 8. Pre-registration and amendment process

1. Before an experiment's first run, its pre-registration file
   (`docs/research/experiments/EXP-XX.md`) is completed using the template,
   committed, and tagged `research/pre-registration-v1`.
2. Any change to a pre-registration after its experiment's first run
   requires: a new file version, a new tag, and a "Deviations" entry in
   that experiment's eventual report explaining what changed and why.
3. Falsifiability is a review gate: a pre-registration that cannot fail —
   whose success threshold is trivially satisfied by any observed result —
   is rejected in review.

## 9. Budget and scheduling

Estimated inference cost (to be confirmed against the P3 pilot): EXP-04 ≈
3 models × 30 tasks × 3 arms × 5 repeats = 1,350 runs; EXP-05 ≈ 3 × 15 × 5
× 3 = 675 plus the deterministic corpus; EXP-06 ≈ 3 × 12 × 3 × 3 = 324;
EXP-08 ≈ 3 × 89 × 3 = 801. If a spend cap binds, reduce repeats before
reducing tasks, and record the reduction in the report's limitations
section. Model families and total inference budget are pending your input
(backlog Blocker B4).

## 10. Reproducibility

Every run's manifest and the reproduction procedure are specified in §29
of the blueprint and `docs/research/reproduction.md` (produced alongside
the experiment runners). In summary: clone at `git_commit_sha`, install
pinned dependencies, verify the container digest and dataset hash, run
`om-exp run <experiment_id> --arm <arm> --manifest <path>`, and compare
metrics within the experiment's stated tolerance. A drill in P13 has a team
member who did not build the experiment reproduce EXP-01, EXP-03 (exact)
and EXP-04 (within tolerance) on a clean machine; the drill result itself
is recorded.
