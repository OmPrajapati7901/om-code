/**
 * LRN-21b tier resolution (AC-21.2b, AC-21.3, DoD-1/DoD-2).
 */
import type { CapabilityRequest } from "@om-code/protocol";
import { describe, expect, it } from "vitest";
import {
  isPolicyError,
  type PolicyRule,
  parseRuleFile,
  resolveTiers,
  type TierRules,
} from "../src/index.js";

function readCapability(paths: readonly string[] = ["notes.md"]): CapabilityRequest {
  return { filesystem: { read: [...paths], write: [] }, risk_class: "read" };
}

function rule(
  id: string,
  outcome: PolicyRule["outcome"],
  match: PolicyRule["match"] = {},
): PolicyRule {
  return { id, outcome, reason: `${id} reason`, match };
}

function tiers(lists: {
  user?: readonly PolicyRule[];
  project?: readonly PolicyRule[];
  session?: readonly PolicyRule[];
}): TierRules[] {
  return (Object.entries(lists) as [TierRules["tier"], readonly PolicyRule[]][]).map(
    ([tier, rules]) => ({ tier, rules }),
  );
}

describe("resolveTiers", () => {
  it("AC-21.2b resolves user > project > session with the winning tier named", () => {
    const decision = resolveTiers(
      readCapability(),
      tiers({
        user: [rule("u-ask", "ask")],
        project: [rule("p-allow", "allow")],
        session: [rule("s-allow", "allow")],
      }),
    );
    expect(decision).toEqual({
      outcome: "ask",
      reason: "[user] u-ask reason",
      ruleId: "u-ask",
      tier: "user",
    });
  });

  it("AC-21.2b a session-only allow names the session tier", () => {
    const decision = resolveTiers(readCapability(), tiers({ session: [rule("s", "allow")] }));
    expect(decision).toEqual({
      outcome: "allow",
      reason: "[session] s reason",
      ruleId: "s",
      tier: "session",
    });
  });

  it("AC-21.2b empty tiers default to ask with a null tier", () => {
    expect(resolveTiers(readCapability(), [])).toEqual({
      outcome: "ask",
      reason: "no policy rule matched this capability",
      ruleId: null,
      tier: null,
    });
    expect(resolveTiers(readCapability(), tiers({ user: [], project: [], session: [] }))).toEqual({
      outcome: "ask",
      reason: "no policy rule matched this capability",
      ruleId: null,
      tier: "user",
    });
  });

  it("AC-21.3 a lower tier cannot loosen a higher tier's deny", () => {
    const allAllow: TierRules[] = tiers({ session: [rule("s-allow", "allow")] });
    expect(
      resolveTiers(readCapability(), [...tiers({ user: [rule("u-deny", "deny")] }), ...allAllow]),
    ).toMatchObject({ outcome: "deny", tier: "user", ruleId: "u-deny" });
    expect(
      resolveTiers(readCapability(), [
        ...tiers({ project: [rule("p-deny", "deny")] }),
        ...allAllow,
      ]),
    ).toMatchObject({ outcome: "deny", tier: "project", ruleId: "p-deny" });
  });

  it("AC-21.3 tightening is honored upward: a session deny beats a user allow", () => {
    const decision = resolveTiers(
      readCapability(),
      tiers({ user: [rule("u-allow", "allow")], session: [rule("s-deny", "deny")] }),
    );
    expect(decision).toMatchObject({ outcome: "deny", tier: "session", ruleId: "s-deny" });
  });

  it("same-precedence ties go to the higher tier", () => {
    const decision = resolveTiers(
      readCapability(),
      tiers({ project: [rule("p-ask", "ask")], session: [rule("s-ask", "ask")] }),
    );
    expect(decision).toMatchObject({ outcome: "ask", tier: "project", ruleId: "p-ask" });
  });

  it("among allows the highest tier's rule wins", () => {
    const decision = resolveTiers(
      readCapability(),
      tiers({ user: [rule("u-allow", "allow")], session: [rule("s-allow", "allow")] }),
    );
    expect(decision).toMatchObject({ outcome: "allow", tier: "user", ruleId: "u-allow" });
  });

  it("tier order in the input never changes the winner", () => {
    const sets = [
      tiers({ session: [rule("s-deny", "deny")], user: [rule("u-allow", "allow")] }),
      tiers({ user: [rule("u-allow", "allow")], session: [rule("s-deny", "deny")] }),
    ];
    for (const set of sets) {
      expect(resolveTiers(readCapability(), set)).toMatchObject({
        outcome: "deny",
        tier: "session",
      });
    }
  });
});

describe("parseRuleFile", () => {
  it("parses a valid rule array", () => {
    expect(
      parseRuleFile(
        JSON.stringify([{ id: "a", outcome: "allow", reason: "ok", match: { paths: ["src"] } }]),
      ),
    ).toEqual([{ id: "a", outcome: "allow", reason: "ok", match: { paths: ["src"] } }]);
  });

  it("an empty array is zero rules, not an error", () => {
    expect(parseRuleFile("[]")).toEqual([]);
  });

  it.each([
    { name: "non-JSON", text: "{oops" },
    { name: "top-level object", text: JSON.stringify({ id: "a" }) },
    {
      name: "bad rule",
      text: JSON.stringify([{ id: "", outcome: "allow", reason: "ok", match: {} }]),
    },
  ])("rejects $name as invalid-rules (DoD-2)", ({ text }) => {
    let caught: unknown;
    try {
      parseRuleFile(text);
    } catch (error) {
      caught = error;
    }
    expect(isPolicyError(caught)).toBe(true);
  });
});
