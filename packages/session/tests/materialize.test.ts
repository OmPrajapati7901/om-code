import { type Entry, parseRecord, type ReadableRecord } from "@om-code/protocol";
import { expect, it } from "vitest";
import { materialize } from "../src/index.js";

it("does not invent resumable metadata from an empty or repair-only journal", () => {
  expect(materialize([])).toMatchObject({
    resumable: false,
    meta: undefined,
    diagnostics: ["missing session_start"],
  });
});

it("preserves metadata, state records and unknown entries without mutating its input", () => {
  const meta = {
    id: "session",
    project_root: "/project",
    cwd: "/project",
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
    status: "active" as const,
    mode: "manual" as const,
    model: { id: "model", base_url: "https://endpoint.test" },
    tags: [],
  };
  const entries: Entry[] = [
    { kind: "session_start", schemaVersion: 1, meta },
    {
      kind: "permission",
      schemaVersion: 1,
      call_id: "c",
      decision: "allow",
      scope: "once",
      decided_by: "user",
      reason: "read",
    },
    { kind: "checkpoint", schemaVersion: 1, files: [], restorable: true },
    {
      kind: "compaction",
      schemaVersion: 1,
      covers: { from: 1, to: 2 },
      summary: {
        goal: "test",
        decisions: [],
        constraints: [],
        changed_files: [],
        tests: [],
        failed_attempts: [],
        approved_permissions: [],
        open_questions: [],
        next_steps: [],
      },
    },
    { kind: "turn_end", schemaVersion: 1, usage: { kind: "unknown" } },
  ];
  const records = entries.map((entry, index) => ({
    v: 1 as const,
    seq: index + 1,
    id: "0193b4c8-0000-7000-8000-000000000001",
    ts: "2026-09-06T01:00:00Z",
    by: "system" as const,
    entry,
    sha256: "0".repeat(64),
  }));
  const before = JSON.stringify(records);
  const view = materialize(records);
  expect(view).toMatchObject({
    resumable: true,
    meta: { status: "idle", updated_at: "2026-09-06T01:00:00Z" },
    permissions: [entries[1]],
    checkpoints: [entries[2]],
    compactions: [entries[3]],
    lastSeq: 5,
  });
  expect(JSON.stringify(records)).toBe(before);
  const parsed = parseRecord({
    ...records[0],
    seq: 6,
    entry: { kind: "future", schemaVersion: 1, raw_value: 42 },
  });
  if (!parsed.ok) throw parsed.error;
  const unknown: ReadableRecord[] = [...records, parsed.record];
  expect(materialize(unknown)).toMatchObject({
    resumable: false,
    unknownEntries: [{ original_kind: "future" }],
  });
  expect(
    materialize([
      {
        ...records[0],
        entry: { kind: "repair", schemaVersion: 1, reason: "torn first record", truncated_from: 1 },
      } as ReadableRecord,
    ]).resumable,
  ).toBe(false);
});
