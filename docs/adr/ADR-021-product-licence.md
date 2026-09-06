# ADR-021: Product Licence — Apache-2.0

> **Scope update (2026-09-05):** This accepted default remains in effect. [ADR-023](ADR-023-macos-openai-compatible-learning-scope.md) governs learning-release implementation timing: export/fleet features and opt-in journal encryption are deferred; the Apache-2.0 licence is retained. Original section references below refer to the [archived blueprint](../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md).

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Leadership (GAP-06 owner)
- **Related:** GAP-06, blueprint §6 (Gaps and Outstanding Decisions)

## Context

GAP-06 left two licensing questions open: what licence covers
`packages/protocol` and `packages/stub-client` (the boundary and wire-format
code most likely to need external security review), and what licence covers
the product as a whole, which the blueprint deferred to "before v0.1.0" under
a standing recommendation of Apache-2.0 for the reviewable core regardless
of the outcome.

Resolving both together removes an outstanding P1 decision and fixes the
`LICENSE` file and any per-package licence metadata before Wave 1 tasks
(workspace scaffolding, `packages/protocol`) start generating files that
would otherwise need a licence header added retroactively.

## Options Considered

1. **Apache-2.0 for the whole product.** One licence, applied uniformly
   across `packages/`, `native/`, and `evals/`.
2. **Proprietary for the whole product**, with no open licence anywhere,
   foreclosing the "enable review" motivation behind the original GAP-06
   recommendation.
3. **Split licensing** — Apache-2.0 for `packages/protocol` and
   `packages/stub-client` only, proprietary elsewhere.

## Decision

**Apache-2.0 for the whole product.** A single licence applies to every
package in the monorepo, including the stub, protocol, kernel, and surfaces.

## Rationale

- Satisfies the original GAP-06 recommendation ("Apache-2.0 for the stub and
  protocol packages regardless, to enable review") without leaving a
  second, deferred decision hanging over the rest of the codebase.
- A single licence avoids split-licensing overhead: no per-package licence
  headers to keep consistent, no dependency-direction rules needed to keep
  proprietary code from importing Apache-licensed code (or vice versa), and
  no separate CLA/contribution terms per package.
- Apache-2.0 is permissive, OSI-approved, compatible with the bulk of the
  TypeScript and Rust ecosystem om-code depends on, and includes an explicit
  patent grant — relevant given the security-boundary nature of `native/`.

## Trade-offs / Risks

- No proprietary-licensing revenue lever for any part of the product;
  competitors may fork and redistribute, including commercially.
- Any future decision to close-source part of the product (e.g., a hosted
  service layer under ADR-017's "hosted mode is future scope") would need
  its own ADR and would only apply to code written after that point —
  Apache-2.0 grants already extended cannot be revoked for existing
  releases.

## Reconsider When (Reversal Trigger)

A commercial or enterprise go-to-market strategy requires closed-source
licensing terms for some part of the product ahead of a v1.0 GA. Any such
change applies prospectively only, via a new ADR, and does not relicense
code already released under Apache-2.0.
