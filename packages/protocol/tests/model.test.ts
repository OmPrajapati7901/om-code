/** AC-5.2, AC-7.7: v1 remains readable; partial calls require explicit outcome. */
import { describe, expect, it } from "vitest";
import {
  assistantMessageV2,
  modelResponseSchema,
  ProviderError,
  parseRecord,
} from "../src/index.js";
import { makeRecord, VALID_ENTRIES } from "./fixtures.js";

const response = {
  content: [{ type: "text", text: "partial" }],
  tool_calls: [{ index: 0, arguments_raw: '{"x":' }],
  usage: { kind: "unknown" },
  outcome: { kind: "interrupted", reason: "disconnected" },
};
describe("versioned model responses", () => {
  it("round-trips partial arguments without inventing IDs or parsed input", () => {
    const parsed = assistantMessageV2.parse({
      kind: "assistant_message",
      schemaVersion: 2,
      ...response,
    });
    expect(parsed.tool_calls[0]).toEqual({ index: 0, arguments_raw: '{"x":' });
    expect(parseRecord(makeRecord(parsed))).toMatchObject({ ok: true, record: { entry: parsed } });
    expect(parseRecord(makeRecord(VALID_ENTRIES.assistant_message))).toMatchObject({ ok: true });
  });
  it("requires complete call identity but allows malformed JSON arguments", () => {
    expect(
      modelResponseSchema.safeParse({ ...response, outcome: { kind: "complete" } }).success,
    ).toBe(false);
    expect(
      modelResponseSchema.safeParse({
        ...response,
        outcome: { kind: "complete" },
        tool_calls: [{ index: 0, name: "read", call_id: "c", arguments_raw: "{'x':}" }],
      }).success,
    ).toBe(true);
  });
  it("rejects duplicate identities, invalid outcomes and unknown credential fields", () => {
    for (const invalid of [
      { ...response, tool_calls: [response.tool_calls[0], response.tool_calls[0]] },
      { ...response, outcome: { kind: "interrupted" } },
      { ...response, credential: "secret" },
    ])
      expect(modelResponseSchema.safeParse(invalid).success).toBe(false);
  });
  it("exposes a shared error with a valid journalable partial snapshot", () => {
    const snapshot = modelResponseSchema.parse(response);
    expect(new ProviderError("disconnected", "lost stream", snapshot)).toMatchObject({
      kind: "disconnected",
      partial: snapshot,
    });
  });
});
