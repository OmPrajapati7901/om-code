# ADR-018: Telemetry Default — Local-First, Export Opt-In

> **Scope update (2026-09-05):** This accepted default remains in effect. [ADR-023](ADR-023-macos-openai-compatible-learning-scope.md) governs learning-release implementation timing: export/fleet features and opt-in journal encryption are deferred; the Apache-2.0 licence is retained. Original section references below refer to the [archived blueprint](../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md).

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Product + Security (GAP-05 owner)
- **Related:** GAP-05, blueprint §18 (Data Governance), §23 (Privacy and Ethical Considerations), C15 (Telemetry component)

## Context

om-code collects two distinct kinds of telemetry: **operational metrics** (session
metadata, tool names, durations, exit codes, token counts, cost — the
`Internal` data class in §18) and **content capture** (prompts, model
outputs, file contents, diffs — the `Confidential` data class). GAP-05 asks
whether the product exports telemetry by default or only on opt-in, and this
decision is P0 because it shapes the config schema, the privacy defaults
every later task inherits, and the `docs/threat-model` review (T6, secret
leakage into transcripts/spans).

om-code is a local-first developer tool that processes the user's own source
code. §23 identifies no regulatory obligation today, but notes that if a
fleet deployment enables export with content capture, the operating
organization becomes responsible for what its developers' prompts contain —
so the default must not create that exposure silently.

## Options Considered

1. **Always export.** Operational metrics are sent to an OTLP backend by
   default whenever one is configured.
2. **Never.** No export path exists; all telemetry stays on local disk
   (`index.sqlite`, spans) with no fleet visibility option.
3. **Opt-in.** Telemetry is generated locally by default and never leaves
   the machine; export to an OTLP backend requires an explicit flag, and
   content capture requires a second, independent flag regardless of the
   export setting.

## Decision

**Opt-in.** Telemetry defaults to local-only. Enabling OTLP export is a
separate, explicit action from enabling content capture — turning on export
never turns on content capture, and a fleet administrator can require export
but cannot silently enable content capture on a user's behalf. The TUI shows
a persistent indicator whenever content capture is active.

## Rationale

- Matches the blueprint's own recommendation for GAP-05 and the data
  governance rule already stated in §18: "Telemetry defaults to local-only
  (ADR-018); enabling OTLP export never enables content capture, which is a
  separate flag."
- Preserves the product's local-first positioning (ADR-017: no server
  infrastructure in v1) — there is no control plane to receive telemetry by
  default in the first place.
- Keeps the T6 mitigation (secret leakage into transcripts/spans) intact:
  the smaller the default data-collection surface, the smaller the
  redaction/scanner burden.
- Still lets an enterprise fleet turn on export where it has a legitimate
  observability need, without forcing that choice on every user.

## Trade-offs / Risks

- Less default telemetry data means less automatic visibility into
  aggregate tool performance, error rates, and cost across the install
  base — diagnosing systemic issues relies more on user-submitted reports.
- Two independent flags (export, content capture) are more config surface
  than a single toggle, and must be documented clearly so users understand
  that enabling export alone does not leak prompt content.

## Reconsider When (Reversal Trigger)

An enterprise contract requires telemetry export to be on by default for
fleet-managed installs. If that happens, the managed tier may set export
`on` via policy, but content capture must remain a separate, explicit flag
even under that override.
