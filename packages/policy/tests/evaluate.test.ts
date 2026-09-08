/**
 * LRN-21a decision core (AC-21.1, AC-21.2a, DoD-1/DoD-2).
 */
import type { CapabilityRequest } from "@om-code/protocol";
import { describe, expect, it } from "vitest";
import { evaluate, type PolicyRule } from "../src/index.js";

function readCapability(paths: readonly string[] = ["notes.md"]): CapabilityRequest {
  return { filesystem: { read: [...paths], write: [] }, risk_class: "read" };
}

function rule(overrides: Partial<PolicyRule> & { id: string }): PolicyRule {
  return {
    outcome: "allow",
    reason: `rule ${overrides.id}`,
    match: {},
    ...overrides,
  };
}

describe("evaluate", () => {
  it("AC-21.1 returns the matching rule's outcome, reason and id", () => {
    const decision = evaluate(readCapability(), [
      rule({
        id: "read-notes",
        outcome: "allow",
        reason: "notes are safe",
        match: { paths: ["notes.md"] },
      }),
    ]);
    expect(decision).toEqual({ outcome: "allow", reason: "notes are safe", ruleId: "read-notes" });
  });

  it("AC-21.1 a non-matching rule is skipped for the next one", () => {
    const decision = evaluate(readCapability(["other.md"]), [
      rule({ id: "miss", match: { paths: ["notes.md"] } }),
      rule({ id: "hit", outcome: "ask", reason: "second", match: {} }),
    ]);
    expect(decision).toEqual({ outcome: "ask", reason: "second", ruleId: "hit" });
  });

  it.each([
    { outcomes: ["deny", "ask"] as const, winner: "deny" },
    { outcomes: ["deny", "allow"] as const, winner: "deny" },
    { outcomes: ["ask", "allow"] as const, winner: "ask" },
    { outcomes: ["allow", "ask", "deny"] as const, winner: "deny" },
    { outcomes: ["allow", "deny", "ask"] as const, winner: "deny" },
  ])("AC-21.2a precedence $outcomes resolves to $winner", ({ outcomes, winner }) => {
    const rules = outcomes.map((outcome, index) => rule({ id: `${outcome}-${index}`, outcome }));
    expect(evaluate(readCapability(), rules).outcome).toBe(winner);
    expect(evaluate(readCapability(), [...rules].reverse()).outcome).toBe(winner);
  });

  it("the first match wins within one precedence", () => {
    const decision = evaluate(readCapability(), [
      rule({ id: "first", outcome: "ask", reason: "first reason" }),
      rule({ id: "second", outcome: "ask", reason: "second reason" }),
    ]);
    expect(decision).toEqual({ outcome: "ask", reason: "first reason", ruleId: "first" });
  });

  it("risk_class matching is membership, omitted is wildcard", () => {
    const scoped = [
      rule({
        id: "writes",
        outcome: "deny",
        reason: "no",
        match: { risk_class: ["write_workspace"] },
      }),
    ];
    expect(evaluate(readCapability(), scoped).outcome).toBe("ask");
    expect(
      evaluate({ filesystem: { read: [], write: ["a.ts"] }, risk_class: "write_workspace" }, scoped)
        .ruleId,
    ).toBe("writes");
  });

  it("path matching is exact-or-under, never substring", () => {
    const scoped = [rule({ id: "src", outcome: "deny", reason: "no", match: { paths: ["src"] } })];
    expect(evaluate(readCapability(["src/a.ts"]), scoped).ruleId).toBe("src");
    expect(evaluate(readCapability(["src"]), scoped).ruleId).toBe("src");
    expect(evaluate(readCapability(["src-evil/x.ts"]), scoped).outcome).toBe("ask");
    expect(evaluate(readCapability(["other/src/a.ts"]), scoped).outcome).toBe("ask");
  });

  it("a rule matches only when every stated key matches", () => {
    const scoped = [
      rule({
        id: "both",
        outcome: "deny",
        reason: "no",
        match: { risk_class: ["read"], paths: ["secret"] },
      }),
    ];
    // Right class, wrong path.
    expect(evaluate(readCapability(["notes.md"]), scoped).outcome).toBe("ask");
    // Right path, wrong class.
    expect(
      evaluate({ filesystem: { read: ["secret/a.ts"], write: [] }, risk_class: "exec" }, scoped)
        .outcome,
    ).toBe("ask");
    expect(evaluate(readCapability(["secret/a.ts"]), scoped).ruleId).toBe("both");
  });

  it("no match defaults to ask with a null rule id", () => {
    expect(evaluate(readCapability(), [])).toEqual({
      outcome: "ask",
      reason: "no policy rule matched this capability",
      ruleId: null,
    });
  });

  it("process capabilities match on risk_class without filesystem paths", () => {
    const scoped = [
      rule({ id: "no-exec", outcome: "deny", reason: "no", match: { risk_class: ["exec"] } }),
    ];
    expect(
      evaluate(
        {
          process: { program: "ls", argv: [], cwd: "/repo" },
          risk_class: "exec",
        },
        scoped,
      ).ruleId,
    ).toBe("no-exec");
    // A paths-only rule never matches a pathless request.
    expect(
      evaluate({ process: { program: "ls", argv: [], cwd: "/repo" }, risk_class: "exec" }, [
        rule({ id: "paths", match: { paths: ["src"] } }),
      ]).outcome,
    ).toBe("ask");
  });
});
