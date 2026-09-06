# om-code — Learning Release

A terminal coding agent harness for macOS, built to understand agent-system design from the inside.

## Current plans and requirements

- **[Delivery Blueprint](docs/om-code-master-delivery-blueprint.md)** — what "done" means for each milestone
- **[Execution Backlog](docs/om-code-agent-execution-backlog.md)** — the 49 tasks in order, with 238 acceptance criteria
- **[Architecture](docs/coding-agent-harness-final-architecture.md)** — how the system is built and why

## Quick orientation

**Start with** [ADR-023](docs/adr/ADR-023-macos-openai-compatible-learning-scope.md) if you want the scope decision in one place: macOS arm64, CLI only, one OpenAI-compatible endpoint, solo developer, learning not shipping.

**If you're building this**, read the blueprint first (it answers "what" and "why"), then the backlog (it answers "in what order"), then the architecture (it answers "how").

**If you're reviewing**, see [AGENTS.md](AGENTS.md) for the repository guidelines, and the backlog's acceptance criteria for what "done" means on each task.

## Status

M1 foundations are implemented: configuration, protocol schemas, durable journal/materialization,
and the OpenAI-compatible streaming provider. The fake provider/recorder, prompt assembly,
turn loop and conversational CLI remain LRN-08–11.

Run `pnpm install --frozen-lockfile` and `pnpm run check`. See the
[LRN-06/07 evidence and contracts](docs/lrn-06-07-implementation-evidence.md) for recovery,
streaming, manual verification commands and current limits.

---

The archived v1.0 production plan (102 tasks, research experiments, multi-agent delivery model) lives in [`docs/architecture/archive/2026-09-05-production-plan/`](docs/architecture/archive/2026-09-05-production-plan/) as reference material, not a gate.
