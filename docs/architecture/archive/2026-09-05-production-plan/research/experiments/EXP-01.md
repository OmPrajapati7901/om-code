# EXP-01 Pre-Registration: Escape-Suite Boundary Comparison

> **Current scope notice (2026-09-05): deferred research plan.** This document's original design and pre-registration labels are preserved below. Its platform/model requirements, section references, and release gates refer to the [archived production blueprint](../../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md), not the current learning release. It does not block macOS/OpenAI-compatible implementation. Before resuming this study, create a dated scope amendment under [ADR-023](../../adr/ADR-023-macos-openai-compatible-learning-scope.md); no experiment execution or result is implied by this document.

- **Status:** Pre-registered
- **Pre-registration date:** 2026-09-05
- **Research question:** RQ-1 — Does moving all execution behind a single
  stub RPC prevent the escape classes that per-command sandboxing leaves
  open, and at what latency cost?
- **Hypothesis:** H1 — Stub-only execution blocks all escape-test classes
  that per-command sandboxing leaves open. Falsifiable prediction: the
  escape suite is blocked 100% in stub mode and leaves ≥ 3 classes
  reachable in per-command mode.
- **Decision this gates:** ADR-002 (Host decides, stub executes).

## 1. Design

Adversarial suite, deterministic — no model is in the loop. The escape
suite (`evals/escape_tests`, built in backlog tasks 25/26) runs every
attack class against each arm's boundary implementation and records
whether the attack was blocked before it reached its target.

## 2. Variables

- **Independent variable:** boundary mode — `stub` vs `per_command`.
- **Arms:**
  | Arm | Boundary mode | Difference from internal baseline |
  |---|---|---|
  | A | `stub` | All execution routed through the executor stub (C8) with re-validation; this is the proposed architecture. |
  | B | `per_command` | Sandboxing applied per invoked command, no central stub; this is the internal baseline (methodology §5). |
- **Controlled variables:** harness commit SHA; container image digest per
  OS; hardware class per OS runner; network egress policy fixed to
  deny-by-default with the task's declared allowlist; concurrency = 1
  escape test at a time per runner; no model involved (deterministic, no
  temperature/seed applicable); task order randomized per OS with a
  recorded seed.
- **Dependent variables:** escape-classes-blocked (primary); per-class
  pass/fail; wall-clock per test (secondary, exploratory).

## 3. Dataset

`evals/escape_tests`: 8 attack classes × 5 variants each, run on 3 OSes
(Linux, macOS, Windows-alpha where applicable per backlog task 22). Classes
correspond to the threat model in blueprint §22.1 (e.g., outside-root
write, egress exfiltration, config-path persistence — T2/T3/T9).

## 4. N

120 runs per arm per OS (8 classes × 5 variants × 3 repeats = 120). Fixed
by the suite's construction, not subject to a pilot — this is a
deterministic adversarial suite, not a variance-driven measurement, so
GAP-08's pilot does not apply here.

## 5. Primary metric

Escape classes blocked, out of 8, per arm per OS.

## 6. Success threshold

Arm A (`stub`) blocks 100% of classes (8/8) on every OS tested. Arm B
(`per_command`) leaves ≥ 3 of 8 classes reachable on at least one OS. If
Arm A fails to block any class, H1 is refuted and ADR-002 is flagged for
reconsideration per its own reversal trigger ("stub overhead > NFR-003
after optimization" is the latency trigger; a security failure here is a
harder, immediate trigger independent of that clause).

## 7. Analysis method

Exact counts of classes blocked per arm per OS. McNemar's test on paired
classes (same class, same variant, both arms) to test whether blocking
outcomes differ systematically between arms. 95% CI on the blocked
proportion via the Clopper–Pearson exact method (appropriate for small
per-OS counts).

## 8. Exclusion rules

A run is excluded, and recorded with a reason in `experiments/index.jsonl`,
if: the manifest fails validation before execution (FR-036); the container
digest does not match the pinned digest; the runner crashes for a reason
unrelated to the attack under test (e.g., OS-level infrastructure failure,
runner OOM not caused by the payload); or the worktree is dirty at run
time. A class that is blocked "by accident" (e.g., an unrelated
infrastructure failure prevents the attack from executing at all, not the
boundary) is recorded as inconclusive for that run, not as blocked.

## 9. Deviations

None (initial pre-registration).
