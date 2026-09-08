/**
 * AC-5.1, AC-5.2, AC-5.4: every entry kind has a valid and an invalid parse
 * test asserting the specific error — plus strictness, schemaVersion and the
 * completeness guard that makes AC-5.1 self-enforcing.
 */

import { describe, expect, it } from "vitest";
import { ENTRY_KINDS, ENTRY_SCHEMAS, type EntryKind } from "../src/index.js";
import { VALID_ENTRIES, validMeta } from "./fixtures.js";

type EntryFixture = {
  readonly kind: EntryKind;
  readonly invalid: unknown;
  readonly expectedPath: string;
  readonly expectedCode: string;
};

const FIXTURES: readonly EntryFixture[] = [
  {
    kind: "session_start",
    invalid: {
      kind: "session_start",
      schemaVersion: 1,
      meta: { ...validMeta(), mode: "superuser" },
    },
    expectedPath: "meta.mode",
    expectedCode: "invalid_value",
  },
  {
    kind: "user_message",
    invalid: { kind: "user_message", schemaVersion: 1, text: 42 },
    expectedPath: "text",
    expectedCode: "invalid_type",
  },
  {
    kind: "assistant_message",
    invalid: {
      kind: "assistant_message",
      schemaVersion: 1,
      content: "hello",
      usage: { kind: "unknown" },
    },
    expectedPath: "content",
    expectedCode: "invalid_type",
  },
  {
    kind: "tool_call",
    invalid: {
      kind: "tool_call",
      schemaVersion: 1,
      call_id: "call_1",
      tool: "bash",
      input: {},
      capability: { risk_class: "nuke" },
    },
    expectedPath: "capability.risk_class",
    expectedCode: "invalid_value",
  },
  {
    kind: "tool_result",
    invalid: {
      kind: "tool_result",
      schemaVersion: 1,
      call_id: "call_1",
      preview: "x",
      truncated: false,
      bytes: 1,
      status: "bogus",
    },
    expectedPath: "status",
    expectedCode: "invalid_value",
  },
  {
    kind: "permission",
    invalid: {
      kind: "permission",
      schemaVersion: 1,
      call_id: "call_1",
      decision: "maybe",
      scope: "once",
      decided_by: "user",
      reason: "x",
    },
    expectedPath: "decision",
    expectedCode: "invalid_value",
  },
  {
    kind: "checkpoint",
    invalid: { kind: "checkpoint", schemaVersion: 1, files: [], restorable: "yes" },
    expectedPath: "restorable",
    expectedCode: "invalid_type",
  },
  {
    kind: "compaction",
    invalid: {
      kind: "compaction",
      schemaVersion: 1,
      covers: { from: 1 },
      summary: {
        goal: "g",
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
    expectedPath: "covers.to",
    expectedCode: "invalid_type",
  },
  {
    kind: "repair",
    invalid: { kind: "repair", schemaVersion: 1, reason: "x", truncated_from: 0 },
    expectedPath: "truncated_from",
    expectedCode: "too_small",
  },
  {
    kind: "turn_end",
    invalid: {
      kind: "turn_end",
      schemaVersion: 1,
      usage: { kind: "known", input_tokens: 1, output_tokens: 1 },
      cost_usd: -1,
    },
    expectedPath: "cost_usd",
    expectedCode: "too_small",
  },
  {
    kind: "prompt",
    invalid: {
      kind: "prompt",
      schemaVersion: 1,
      instructions: [{ path: "AGENTS.md", sha256: "not-a-hash" }],
    },
    expectedPath: "instructions.0.sha256",
    expectedCode: "invalid_format",
  },
  {
    kind: "error",
    invalid: {
      kind: "error",
      schemaVersion: 1,
      source: "provider",
      reason: "",
      message: "failed",
      retryable: false,
    },
    expectedPath: "reason",
    expectedCode: "too_small",
  },
];

function v1Schema(kind: EntryKind) {
  const schema = ENTRY_SCHEMAS[kind].get(1);
  if (schema === undefined) {
    throw new Error(`no schemaVersion 1 registered for entry kind "${kind}"`);
  }
  return schema;
}

describe("entry schemas", () => {
  it("covers every registered kind exactly once (AC-5.1 completeness)", () => {
    expect([...FIXTURES.map((fixture) => fixture.kind)].sort()).toEqual([...ENTRY_KINDS].sort());
    expect(FIXTURES).toHaveLength(12);
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.kind} accepts its valid shape`, () => {
      expect(v1Schema(fixture.kind).safeParse(VALID_ENTRIES[fixture.kind]).success).toBe(true);
    });

    it(`${fixture.kind} rejects with a specific error at ${fixture.expectedPath}`, () => {
      const result = v1Schema(fixture.kind).safeParse(fixture.invalid);
      expect(result.success).toBe(false);
      if (result.success) {
        return;
      }
      const issue = result.error.issues[0];
      if (issue === undefined) {
        throw new Error(`no issues reported for invalid ${fixture.kind}`);
      }
      expect(issue.code).toBe(fixture.expectedCode);
      expect(issue.path.map((segment) => String(segment)).join(".")).toBe(fixture.expectedPath);
    });

    it(`${fixture.kind} rejects unrecognized fields (strict)`, () => {
      const valid = VALID_ENTRIES[fixture.kind];
      if (typeof valid !== "object" || valid === null) {
        throw new Error(`valid fixture for ${fixture.kind} is not an object`);
      }
      const result = v1Schema(fixture.kind).safeParse({ ...valid, bogus_key: 1 });
      expect(result.success).toBe(false);
      if (result.success) {
        return;
      }
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    });

    it(`${fixture.kind} requires schemaVersion (AC-5.4)`, () => {
      const valid = VALID_ENTRIES[fixture.kind];
      if (typeof valid !== "object" || valid === null || Array.isArray(valid)) {
        throw new Error(`valid fixture for ${fixture.kind} is not an object`);
      }
      const { schemaVersion: _dropped, ...withoutVersion } = valid as Record<string, unknown>;
      expect(v1Schema(fixture.kind).safeParse(withoutVersion).success).toBe(false);
    });
  }

  it("accepts thinking and tool_use blocks on assistant_message", () => {
    const result = v1Schema("assistant_message").safeParse({
      kind: "assistant_message",
      schemaVersion: 1,
      content: [
        { type: "thinking", text: "let me search first" },
        { type: "tool_use", call_id: "call_1", tool: "grep", input: { pattern: "auth" } },
        { type: "text", text: "searching now" },
      ],
      usage: { kind: "unknown" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an image block carrying inline data (must be a blob_ref)", () => {
    const result = v1Schema("assistant_message").safeParse({
      kind: "assistant_message",
      schemaVersion: 1,
      content: [{ type: "image", media_type: "image/png", data: "aGVsbG8=" }],
      usage: { kind: "unknown" },
    });
    expect(result.success).toBe(false);
  });

  describe("permission v2 (LRN-21d)", () => {
    function v2Schema() {
      const schema = ENTRY_SCHEMAS.permission.get(2);
      if (schema === undefined) throw new Error("no schemaVersion 2 registered for permission");
      return schema;
    }

    it("accepts ask decisions and system attribution", () => {
      expect(
        v2Schema().safeParse({
          kind: "permission",
          schemaVersion: 2,
          call_id: "call_1",
          decision: "ask",
          scope: "once",
          decided_by: "system",
          reason: "no policy rule matched this capability",
        }).success,
      ).toBe(true);
    });

    it("rejects an unknown decided_by with a specific error", () => {
      const result = v2Schema().safeParse({
        kind: "permission",
        schemaVersion: 2,
        call_id: "call_1",
        decision: "deny",
        scope: "once",
        decided_by: "oracle",
        reason: "x",
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.code).toBe("invalid_value");
      expect(result.error.issues[0]?.path.map(String).join(".")).toBe("decided_by");
    });

    it("v1 stays readable beside v2 (adjacent-version pattern)", () => {
      expect(
        ENTRY_SCHEMAS.permission.get(1)?.safeParse({
          kind: "permission",
          schemaVersion: 1,
          call_id: "call_1",
          decision: "deny",
          scope: "session",
          decided_by: "user",
          reason: "no",
        }).success,
      ).toBe(true);
    });
  });
});
