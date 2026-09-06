/**
 * CapabilityRequest (blueprint §8.3): the two interfaces to freeze early.
 * Includes the DoD-2 network row — a record requesting network fails loudly
 * naming D-01 rather than being silently dropped.
 */

import { describe, expect, it } from "vitest";
import { capabilityRequestSchema, parseRecord } from "../src/index.js";
import { makeRecord } from "./fixtures.js";

describe("capability", () => {
  it("accepts a minimal read capability", () => {
    expect(capabilityRequestSchema.safeParse({ risk_class: "read" }).success).toBe(true);
  });

  it("accepts a full process + filesystem capability", () => {
    const result = capabilityRequestSchema.safeParse({
      process: { program: "/bin/ls", argv: ["-la"], cwd: "/Users/test/repo", shell: "bash" },
      filesystem: { read: ["src/a.ts"], write: [] },
      risk_class: "exec",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a capability requesting network (D-01)", () => {
    const result = capabilityRequestSchema.safeParse({
      filesystem: { read: [], write: [] },
      network: { connect: ["example.com:443"] },
      risk_class: "exec",
    });
    expect(result.success).toBe(false);
  });

  it("a tool_call requesting network fails as invalid-entry via parseRecord", () => {
    const result = parseRecord(
      makeRecord({
        kind: "tool_call",
        schemaVersion: 1,
        call_id: "call_1",
        tool: "bash",
        input: {},
        capability: {
          filesystem: { read: [], write: [] },
          network: { connect: ["example.com:443"] },
          risk_class: "exec",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-entry");
      expect(result.error.message).toContain("capability.network");
    }
  });

  it("requires risk_class and rejects unknown keys", () => {
    expect(capabilityRequestSchema.safeParse({ filesystem: { read: [], write: [] } }).success).toBe(
      false,
    );
    expect(capabilityRequestSchema.safeParse({ risk_class: "read", bogus: true }).success).toBe(
      false,
    );
    expect(
      capabilityRequestSchema.safeParse({
        process: { argv: [], cwd: "/tmp" },
        risk_class: "exec",
      }).success,
    ).toBe(false);
  });
});
