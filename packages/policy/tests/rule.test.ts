/**
 * LRN-21a rule schema (DoD-2: malformed rules fail with a named error).
 */
import { describe, expect, it } from "vitest";
import { policyRuleSchema } from "../src/index.js";

describe("policyRuleSchema", () => {
  it("accepts a fully specified rule", () => {
    expect(
      policyRuleSchema.safeParse({
        id: "no-secrets",
        outcome: "deny",
        reason: "secret material stays unread",
        match: { risk_class: ["read"], paths: [".env"] },
      }).success,
    ).toBe(true);
  });

  it("accepts an explicit match-all rule", () => {
    const parsed = policyRuleSchema.safeParse({
      id: "default-ask",
      outcome: "ask",
      reason: "catch-all",
      match: {},
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    { name: "empty id", rule: { id: "", outcome: "deny", reason: "r", match: {} } },
    { name: "empty reason", rule: { id: "x", outcome: "deny", reason: "", match: {} } },
    { name: "unknown outcome", rule: { id: "x", outcome: "maybe", reason: "r", match: {} } },
    { name: "missing match", rule: { id: "x", outcome: "deny", reason: "r" } },
    {
      name: "unknown matcher key",
      rule: { id: "x", outcome: "deny", reason: "r", match: { tool: "read" } },
    },
  ])("rejects a rule with $name", ({ rule }) => {
    const parsed = policyRuleSchema.safeParse(rule);
    expect(parsed.success).toBe(false);
  });
});
