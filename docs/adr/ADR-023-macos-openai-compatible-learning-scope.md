# ADR-023: macOS and OpenAI-Compatible First, with Extension Points

- **Status:** Accepted scope; implementation not started
- **Date:** 2026-09-05
- **Decision source:** The user's direction: personal learning, MacBook only for now, OpenAI-compatible model format initially, open to extension.
- **Related:** [current blueprint](../om-code-master-delivery-blueprint.md), [current architecture](../coding-agent-harness-final-architecture.md), [current backlog](../om-code-agent-execution-backlog.md).

## Context

The earlier plan assumed a production research harness, three operating systems,
several native provider APIs, 3–4 full-time engineers, and eight formal experiments.
Those are not prerequisites for the user's learning project. The active plans
need to select a useful first implementation without making future providers or
platforms require a rewrite.

## Decision

Start on macOS on the developer's MacBook. The current machine is arm64, so that
is the initial verified target. Intel Mac verification may follow; Linux,
Windows, PowerShell, containers, and remote placement are deferred until the
user expands scope. No multi-platform CI or signing procurement gates local work.

Interpret OpenAI-compatible as Chat Completions with configurable API base URL,
model ID, and credential reference. This does not select a particular vendor or
model. Keep the kernel dependent on normalized `ModelProvider` contracts and
capabilities. Add compatible endpoints through tested profiles; add other API
formats through adapters. Do not assume Responses, native compaction, reasoning
parameters, usage reporting, or tool support from a model's name.

Retain TypeScript and a minimal Rust executor as implementation choices. Use the
macOS sandbox through a placement interface. Keep trusted storage on the host
and workspace I/O behind the executor. Define one canonical wire-schema source.

Build a CLI, basic journal/resume, exact edits, bounded commands, manual/read-only
policy, and deterministic fixtures first. Policy precedes executable model tools.
Persist operation intent and reconcile unknown outcomes after crashes; do not
automatically repeat arbitrary commands.

Keep the broader architecture as deferred options. TUI, generalized entity
patches, SQLite, fork/rewind, Directors, plugins, MCP/ACP, provider-native features,
Python/Harbor, and public distribution are not first-release dependencies. The
current blueprint's LR-FR requirements and L0–L4 milestones replace the archived
production requirements as execution gates.

## Effect on earlier decisions and documents

- ADR-018's local-first telemetry default stands. OTLP and fleet features are deferred.
- ADR-021's Apache-2.0 decision and the existing LICENSE stand.
- ADR-022's encryption-off default stands. Opt-in encryption remains a future
  storage capability; it is not claimed to exist or required for this release.
- Earlier architecture-table ADRs retain historical rationale, but this ADR
  supersedes their mandatory multi-platform, native multi-provider, generalized
  state, advanced extension, research, and release scope for the learning phase.
- The blanket ban on host filesystem writes is narrowed to workspace effects;
  trusted storage must write application-owned state without giving the stub access.
- Ordinary worker threads or unsandboxed subprocesses are not accepted as an
  untrusted-plugin security boundary. Executable plugins are deferred.
- A proxy cannot inject HTTPS headers into an opaque TLS tunnel. Initially the
  host authenticates its own inference requests and tool networking stays disabled.
- ACP framing, if introduced later, follows ACP's transport rather than internal
  stub `Content-Length` framing.
- The previous source-map ban, predetermined PR sequence, two-person approval
  gate, and research pre-registration gate are not solo-learning prerequisites.
  Relevant testing, secret protection, and careful review remain required.

Original plans are retained in the archive directory `docs/architecture/archive/2026-09-05-production-plan/`.
Existing experiment documents are marked deferred without rewriting their
historical designs or claiming results. New scope changes for a resumed study
need dated amendments before reported runs.

## Trade-offs

There is no initial guarantee of other-platform support or compatibility with
every endpoint advertising an OpenAI-shaped API. A small fixed-profile model
contract intentionally omits native features. Simple journals postpone advanced
navigation and plugin replay. Those limits reduce the amount of infrastructure
needed before learning from a usable coding loop.

## Reconsider when

The user needs another API, platform, integration, or release channel; an observed
workflow needs a deferred feature; or measurements justify a more advanced
storage/context design. Add the corresponding adapter and tests explicitly.
Do not widen scope based only on an archived roadmap entry.
