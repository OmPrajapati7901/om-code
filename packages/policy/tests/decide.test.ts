/**
 * LRN-21d fail-closed decisions (AC-21.4, AC-21.5, DoD-1/DoD-2).
 */
import type { CapabilityRequest } from "@om-code/protocol";
import { describe, expect, it } from "vitest";
import { decide, type TierRules } from "../src/index.js";

function readCapability(): CapabilityRequest {
  return { filesystem: { read: ["notes.md"], write: [] }, risk_class: "read" };
}

describe("decide", () => {
  it("AC-21.4 a throw anywhere in evaluation becomes deny, never allow", () => {
    const exploding = new Proxy(readCapability(), {
      get: () => {
        throw new Error("boom");
      },
    });
    const decision = decide(exploding, []);
    expect(decision.outcome).toBe("deny");
    expect(decision.reason).toContain("policy evaluation failed");
    expect(decision.reason).toContain("boom");
    expect(decision.ruleId).toBeNull();
  });

  it.each([
    { name: "null", raw: null },
    { name: "array", raw: [] },
    { name: "missing risk_class", raw: { filesystem: { read: ["a"], write: [] } } },
    { name: "unknown risk_class", raw: { risk_class: "nuke" } },
    { name: "non-string path", raw: { filesystem: { read: [42], write: [] }, risk_class: "read" } },
  ])("AC-21.5 $name becomes ask, never allow", ({ raw }) => {
    const decision = decide(raw, []);
    expect(decision.outcome).toBe("ask");
    expect(decision.ruleId).toBeNull();
    expect(decision.reason).toContain("unrecognized capability");
  });

  it("a valid capability resolves tiers normally", () => {
    const tiers: TierRules[] = [
      { tier: "user", rules: [{ id: "u", outcome: "deny", reason: "no", match: {} }] },
    ];
    expect(decide(readCapability(), tiers)).toMatchObject({
      outcome: "deny",
      ruleId: "u",
      tier: "user",
    });
  });

  it("builtin read-allow grants with a visible id when nothing else matches", () => {
    const decision = decide(readCapability(), []);
    expect(decision).toMatchObject({
      outcome: "allow",
      ruleId: "builtin/allow-read",
      tier: "session",
    });
  });

  it("an explicit deny beats the builtin read-allow", () => {
    const decision = decide(readCapability(), [
      { tier: "project", rules: [{ id: "p", outcome: "deny", reason: "no", match: {} }] },
    ]);
    expect(decision).toMatchObject({ outcome: "deny", ruleId: "p" });
  });

  it("the builtin never grants non-read capabilities", () => {
    const decision = decide(
      { filesystem: { read: [], write: ["a.ts"] }, risk_class: "write_workspace" },
      [],
    );
    expect(decision.outcome).toBe("ask");
  });
});
