/**
 * AC-5.5: unrecognized kinds are preserved verbatim, unknown schemaVersions
 * are typed errors naming the version — plus the envelope failure paths
 * (DoD-2) and the dispatch ordering guarantee.
 */

import { describe, expect, it } from "vitest";
import { isProtocolError, parseRecord } from "../src/index.js";
import { makeRecord, VALID_ENTRIES } from "./fixtures.js";

describe("parseRecord", () => {
  it.each(["constructor", "__proto__", "toString"])(
    "preserves inherited registry property %s as an unknown kind (LRN-06 regression)",
    (kind) => {
      const result = parseRecord(makeRecord({ kind, schemaVersion: 1 }));
      expect(result).toMatchObject({
        ok: true,
        unknownEntry: true,
        record: { entry: { original_kind: kind } },
      });
    },
  );
  it("parses a valid record for every known kind", () => {
    for (const entry of Object.values(VALID_ENTRIES)) {
      const result = parseRecord(makeRecord(entry));
      expect(result.ok).toBe(true);
    }
  });

  it("preserves an unrecognized kind verbatim with byte-identical raw", () => {
    const entry = JSON.parse(JSON.stringify({ kind: "future_thing", schemaVersion: 9, x: 1 }));
    const result = parseRecord(makeRecord(entry));
    expect(result.ok).toBe(true);
    if (!result.ok || !("unknownEntry" in result)) {
      throw new Error("expected the unknown-entry success variant");
    }
    expect(result.record.entry).toEqual({
      kind: "unknown_entry",
      original_kind: "future_thing",
      schemaVersion: 9,
      raw: entry,
    });
    expect(JSON.stringify(result.record.entry.raw)).toBe(JSON.stringify(entry));
  });

  it("an unknown kind at version 99 is preserved, not version-rejected (ordering)", () => {
    const result = parseRecord(makeRecord({ kind: "future_thing", schemaVersion: 99 }));
    expect(result.ok).toBe(true);
    if (!result.ok || !("unknownEntry" in result)) {
      throw new Error("expected the unknown-entry success variant");
    }
    expect(result.record.entry.kind).toBe("unknown_entry");
  });

  it("an unknown schemaVersion is a typed error naming kind, seen and supported", () => {
    const result = parseRecord(makeRecord({ kind: "user_message", schemaVersion: 99, text: "hi" }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(isProtocolError(result.error)).toBe(true);
    expect(result.error.kind).toBe("unknown-schema-version");
    expect(result.error.message).toContain("user_message");
    expect(result.error.message).toContain("99");
    expect(result.error.message).toContain("1");
  });

  it("a known kind and version with an invalid body names the dotted field", () => {
    const result = parseRecord(makeRecord({ kind: "user_message", schemaVersion: 1, text: 42 }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("invalid-entry");
    expect(result.error.message).toContain("text");
  });

  it("a non-object entry is an invalid-entry error", () => {
    const result = parseRecord(makeRecord("just a string"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-entry");
    }
  });

  it("an entry missing kind/schemaVersion is an invalid-entry error", () => {
    const result = parseRecord(makeRecord({ text: "hi" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-entry");
    }
  });

  it("accepts tool: actors and passes turn_id through", () => {
    const result = parseRecord(
      makeRecord(VALID_ENTRIES.tool_result, { by: "tool:bash", turn_id: "turn_1" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.record.by).toBe("tool:bash");
    expect(result.record.turn_id).toBe("turn_1");
  });

  const ENVELOPE_FAILURES: ReadonlyArray<{
    readonly label: string;
    readonly override: Record<string, unknown>;
    readonly field: string;
  }> = [
    { label: "zero seq", override: { seq: 0 }, field: "seq" },
    { label: "negative seq", override: { seq: -3 }, field: "seq" },
    { label: "fractional seq", override: { seq: 1.5 }, field: "seq" },
    { label: "bad id", override: { id: "not-a-uuid" }, field: "id" },
    {
      label: "non-v7 id",
      override: { id: "550e8400-e29b-41d4-a716-446655440000" },
      field: "id",
    },
    { label: "non-RFC-3339 ts", override: { ts: "yesterday" }, field: "ts" },
    { label: "bad by", override: { by: "alien" }, field: "by" },
    { label: "empty tool actor", override: { by: "tool:" }, field: "by" },
    { label: "short sha256", override: { sha256: "abc" }, field: "sha256" },
    { label: "wrong envelope version", override: { v: 2 }, field: "v" },
  ];
  it.each(ENVELOPE_FAILURES)(
    "malformed envelope ($label) is an invalid-record error naming the field",
    ({ override, field }) => {
      const result = parseRecord({ ...makeRecord(VALID_ENTRIES.user_message), ...override });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.kind).toBe("invalid-record");
      expect(result.error.message).toContain(field);
    },
  );

  it("a missing sha256 is an invalid-record error naming the field", () => {
    const base = makeRecord(VALID_ENTRIES.user_message);
    delete base.sha256;
    const result = parseRecord(base);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-record");
      expect(result.error.message).toContain("sha256");
    }
  });

  it("an unrecognized envelope field is an invalid-record error (strict)", () => {
    const result = parseRecord({
      ...makeRecord(VALID_ENTRIES.user_message),
      bogus: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-record");
    }
  });
});
