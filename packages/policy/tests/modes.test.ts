/**
 * LRN-21c modes and the full matrix (AC-21.6, AC-21.2c, DoD-1).
 *
 * Mode rules merge into the user tier list, so deny-anywhere-wins keeps
 * `read_only` global across every tier. Each matrix cell pins its expected
 * outcome — this is the first task where all three dimensions exist.
 */
import type { CapabilityRequest } from "@om-code/protocol";
import { describe, expect, it } from "vitest";
import {
  type PolicyMode,
  type PolicyRule,
  type PolicyTier,
  resolveTiers,
  rulesForMode,
} from "../src/index.js";

type CapabilityClass = CapabilityRequest["risk_class"];

const MODES: readonly PolicyMode[] = ["read_only", "manual"];
const CLASSES: readonly CapabilityClass[] = ["read", "write_workspace", "exec", "destructive"];
const TIERS: readonly PolicyTier[] = ["user", "project", "session"];

function capabilityFor(class_: CapabilityClass): CapabilityRequest {
  switch (class_) {
    case "read":
      return { filesystem: { read: ["notes.md"], write: [] }, risk_class: "read" };
    case "write_workspace":
      return { filesystem: { read: [], write: ["notes.md"] }, risk_class: "write_workspace" };
    case "exec":
      return { process: { program: "ls", argv: [], cwd: "/repo" }, risk_class: "exec" };
    case "destructive":
      return { filesystem: { read: [], write: ["notes.md"] }, risk_class: "destructive" };
  }
}

function withMode(mode: PolicyMode, tier: PolicyTier): { tier: PolicyTier; rules: PolicyRule[] }[] {
  return [
    { tier: "user", rules: rulesForMode(mode) },
    { tier, rules: [{ id: `${tier}-allow`, outcome: "allow", reason: "grant", match: {} }] },
  ];
}

describe("rulesForMode", () => {
  it("AC-21.6 manual imposes nothing", () => {
    expect(rulesForMode("manual")).toEqual([]);
  });

  it("AC-21.6 read_only denies every non-read class with attributable ids", () => {
    const rules = rulesForMode("read_only");
    expect(rules.map((rule) => rule.id)).toEqual([
      "read-only/deny-write_workspace",
      "read-only/deny-exec",
      "read-only/deny-destructive",
    ]);
    for (const rule of rules) {
      expect(rule.outcome).toBe("deny");
      expect(rule.reason).toContain("read_only mode denies");
    }
  });
});

describe("AC-21.2c mode x capability-class x tier matrix", () => {
  const cells = MODES.flatMap((mode) =>
    CLASSES.flatMap((class_) => TIERS.map((tier) => ({ mode, class: class_, tier }) as const)),
  );
  it.each(cells)(
    "$mode / $class / $tier resolves as specified",
    ({ mode, class: class_, tier }) => {
      const decision = resolveTiers(capabilityFor(class_), withMode(mode, tier));
      if (mode === "manual" || class_ === "read") {
        expect(decision).toMatchObject({
          outcome: "allow",
          tier,
          ruleId: `${tier}-allow`,
        });
      } else {
        expect(decision).toMatchObject({
          outcome: "deny",
          ruleId: `read-only/deny-${class_}`,
        });
      }
    },
  );

  it("read_only denies a destructive request no tier allows", () => {
    for (const tier of TIERS) {
      const decision = resolveTiers(capabilityFor("destructive"), withMode("read_only", tier));
      expect(decision.outcome).toBe("deny");
    }
  });
});
