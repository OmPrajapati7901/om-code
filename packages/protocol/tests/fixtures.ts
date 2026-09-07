/**
 * Shared fixtures for the protocol suite (LRN-05).
 *
 * VALID_ENTRIES is typed Record<EntryKind, unknown>, so adding a kind to the
 * registry without adding a fixture is a compile error — on top of the
 * runtime completeness test in entries.test.ts.
 */

import type { EntryKind } from "../src/entries.js";

export const RECORD_ID = "0193b4c8-0000-7000-8000-000000000000";
export const RECORD_TS = "2026-09-06T12:00:00Z";
export const RECORD_SHA = "0".repeat(64);

export function makeRecord(
  entry: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    v: 1,
    seq: 1,
    id: RECORD_ID,
    ts: RECORD_TS,
    by: "user",
    sha256: RECORD_SHA,
    entry,
    ...overrides,
  };
}

export function validMeta(): Record<string, unknown> {
  return {
    id: "0193b4c8-0000-7000-8000-000000000001",
    project_root: "/Users/test/repo",
    cwd: "/Users/test/repo",
    created_at: RECORD_TS,
    updated_at: RECORD_TS,
    status: "active",
    mode: "manual",
    model: { id: "qwen/qwen3.8-27b", base_url: "https://example.test/v1" },
    tags: [],
  };
}

export function validSummary(): Record<string, unknown> {
  return {
    goal: "answer the question",
    decisions: ["use grep first"],
    constraints: [],
    changed_files: [],
    tests: [],
    failed_attempts: [],
    approved_permissions: [],
    open_questions: [],
    next_steps: [],
  };
}

export const VALID_ENTRIES: Record<EntryKind, unknown> = {
  session_start: { kind: "session_start", schemaVersion: 1, meta: validMeta() },
  user_message: { kind: "user_message", schemaVersion: 1, text: "where is auth handled?" },
  assistant_message: {
    kind: "assistant_message",
    schemaVersion: 1,
    content: [{ type: "text", text: "hello" }],
    usage: { kind: "unknown" },
  },
  tool_call: {
    kind: "tool_call",
    schemaVersion: 1,
    call_id: "call_1",
    tool: "grep",
    input: { pattern: "auth" },
    capability: { filesystem: { read: ["src/auth.ts"], write: [] }, risk_class: "read" },
  },
  tool_result: {
    kind: "tool_result",
    schemaVersion: 1,
    call_id: "call_1",
    preview: "src/auth.ts:12",
    truncated: false,
    bytes: 14,
    status: "ok",
  },
  permission: {
    kind: "permission",
    schemaVersion: 1,
    call_id: "call_1",
    decision: "allow",
    scope: "once",
    decided_by: "user",
    reason: "read-only search",
  },
  checkpoint: {
    kind: "checkpoint",
    schemaVersion: 1,
    files: [{ path: "src/auth.ts", sha256: "0".repeat(64) }],
    restorable: true,
  },
  compaction: {
    kind: "compaction",
    schemaVersion: 1,
    covers: { from: 1, to: 2 },
    summary: validSummary(),
  },
  repair: { kind: "repair", schemaVersion: 1, reason: "hash mismatch", truncated_from: 7 },
  turn_end: {
    kind: "turn_end",
    schemaVersion: 1,
    usage: { kind: "known", input_tokens: 10, output_tokens: 5 },
  },
  prompt: {
    kind: "prompt",
    schemaVersion: 1,
    instructions: [{ path: "AGENTS.md", sha256: "0".repeat(64) }],
  },
  error: {
    kind: "error",
    schemaVersion: 1,
    source: "provider",
    reason: "http",
    message: "HTTP 500",
    status: 500,
    retryable: true,
  },
};
