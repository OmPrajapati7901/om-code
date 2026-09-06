# ADR-022: Session Journal Encryption at Rest — Off by Default

> **Scope update (2026-09-05):** This accepted default remains in effect. [ADR-023](ADR-023-macos-openai-compatible-learning-scope.md) governs learning-release implementation timing: export/fleet features and opt-in journal encryption are deferred; the Apache-2.0 licence is retained. Original section references below refer to the [archived blueprint](../architecture/archive/2026-09-05-production-plan/loom-master-delivery-blueprint.md).

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Security (GAP-10 owner)
- **Related:** GAP-10, blueprint §18 (Data Governance), §22 (Security Architecture), C14 (Storage component)

## Context

The session journal, snapshots and blobs hold the `Confidential` data class
(§18): prompts, model outputs, file contents, diffs, tool stdout/stderr.
These already live under `~/.om-code` with `0600` file permissions, next to the
source tree they describe. GAP-10 asks whether journal contents should also
be encrypted at rest by default, or only on request, and is P2 because it
affects the storage layer (C14) that Wave 1 task 10 (journal writer/reader)
implements.

## Options Considered

1. **On by default.** Every journal is encrypted at rest unconditionally,
   requiring key management (generation, storage, unlock) for every session
   from the first run.
2. **Off by default, opt-in encryption available.** Filesystem permissions
   (`0600`) are the default protection; an explicit flag enables
   age/AES-GCM encryption for users who need it.
3. **Off, no encryption option at all.** Filesystem permissions only, with
   no path to stronger protection even for users who want it.

## Decision

**Off by default**, with an opt-in `age`/AES-GCM encryption mode. Unencrypted
journals rely on `0600` filesystem permissions and local-user-only access,
matching every other Confidential artifact under `~/.om-code`. Users with a
regulatory or organizational need can enable encryption explicitly.

## Rationale

- Matches the blueprint's own recommendation for GAP-10: journal contents
  describe the same source code that already sits unencrypted on disk right
  next to them, so encrypting only the journal by default protects against
  a narrow threat model (an attacker who can read `~/.om-code` but not the
  project's working tree) without addressing the more realistic one (full
  disk access).
- Avoids forcing key-management UX (where is the key stored, how is it
  unlocked, what happens on a lost key) onto every user by default —
  om-code is a local single-user product (§22, "no login") and mandatory
  encryption would need a credential story it doesn't otherwise have.
- Keeps the opt-in path available for regulated users, satisfying the part
  of GAP-10 that calls for an "opt-in age/AES-GCM mode."

## Trade-offs / Risks

- Journals remain plaintext-on-disk by default, so anyone with filesystem
  access to `~/.om-code` (a shared machine, a misconfigured backup, a stolen
  disk) can read session transcripts, including any secrets that redaction
  missed. This is a strict extension of the existing risk to the project's
  own source tree, not a new one, but it is still worth stating plainly in
  user-facing docs per §23's transparency principle.
- Opt-in features are used less than defaults; regulated users who don't
  know the flag exists get no protection beyond `0600`.

## Reconsider When (Reversal Trigger)

A regulatory requirement mandates at-rest encryption by default for the
data classes om-code stores, or a security incident demonstrates that `0600`
filesystem permissions are insufficient protection in practice (e.g., a
common deployment pattern exposes `~/.om-code` more broadly than assumed).
